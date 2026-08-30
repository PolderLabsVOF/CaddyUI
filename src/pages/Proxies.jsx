import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Loader2, Power, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { appendSimpleProxy, parseCaddyfile, setProxyDisabled, updateSimpleProxy } from '../../server/caddyParser.js';
import {
  ConfirmModal,
  MiddlewarePicker,
  Notice,
  ProxyRow,
  StatCards,
  deleteConfirm,
  normalizeLogging,
  previewProxyBlock,
  readBlockAtLine,
  replaceBlockAtLine,
  rootDomain,
  selectedImportNames,
  selectedTagNames,
} from '../components/common.jsx';
import { HEALTH_POLL_INTERVAL_MS } from '../App.jsx';

const localTest = import.meta.env.DEV && import.meta.env.VITE_CADDYUI_LOCAL_TEST === '1';

const compareText = (a, b) => String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());
const compareBool = (a, b) => Number(Boolean(a)) - Number(Boolean(b));
const defaultSectionSort = { key: 'host', dir: 'asc' };

function proxySectionKey(viewMode, groupName) {
  return `${viewMode}:${groupName}`;
}

function sortValue(site, key, health) {
  if (key === 'domain') return rootDomain(site.addresses?.[0]);
  if (key === 'host') return site.addresses?.[0] || '';
  if (key === 'upstream') return site.proxies?.[0]?.upstreams?.join(' ') || '';
  if (key === 'description') return site.description || '';
  if (key === 'local') return Boolean(health?.[site.id]?.local?.online);
  if (key === 'category') return site.category || '';
  if (key === 'tags') return (site.tags || []).join(', ');
  if (key === 'imports') return [...(site.imports || []).map((i) => i.name), ...((site.proxies?.[0]?.imports || []).map((i) => i.name))].join(', ');
  return '';
}

function sortSites(a, b, sort, health) {
  if (sort.key === 'local') {
    const value = compareBool(sortValue(a, sort.key, health), sortValue(b, sort.key, health));
    if (value !== 0) return sort.dir === 'asc' ? value : -value;
    return compareText(a.addresses?.[0], b.addresses?.[0]);
  }
  const value = compareText(sortValue(a, sort.key, health), sortValue(b, sort.key, health));
  if (value !== 0) return sort.dir === 'asc' ? value : -value;
  return compareText(a.addresses?.[0], b.addresses?.[0]);
}

function AutoCompleteInput({ value, onChange, suggestions, placeholder = '' }) {
  const [open, setOpen] = useState(false);
  const prefix = String(value || '').trim().toLowerCase();
  const matches = useMemo(
    () =>
      suggestions.filter((item) =>
        !prefix ? true : String(item).toLowerCase().includes(prefix)
      ),
    [suggestions, prefix]
  );
  return (
    <div className="autocomplete-field">
      <input
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => onChange(e.target.value)}
      />
      {open && matches.length > 0 && (
        <div className="autocomplete-menu">
          {matches.slice(0, 10).map((item) => (
            <button
              type="button"
              key={item}
              className="autocomplete-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(item);
                setOpen(false);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TagAutoCompleteInput({ value, onChange, suggestions, placeholder = '' }) {
  const [open, setOpen] = useState(false);
  const parts = String(value || '').split(',');
  const prefixParts = parts.slice(0, -1).map((x) => x.trim()).filter(Boolean);
  const used = new Set(prefixParts.map((x) => x.toLowerCase()));
  const current = (parts[parts.length - 1] || '').trim().toLowerCase();
  const matches = useMemo(
    () =>
      suggestions.filter((item) => {
        const lower = String(item).toLowerCase();
        if (used.has(lower)) return false;
        if (!current) return true;
        return lower.includes(current);
      }),
    [suggestions, used, current]
  );
  const applyTag = (tag) => {
    const next = [...prefixParts, tag].join(', ');
    onChange(`${next}, `);
  };
  return (
    <div className="autocomplete-field">
      <input
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && matches.length > 0 && (
        <div className="autocomplete-menu">
          {matches.slice(0, 12).map((item) => (
            <button
              type="button"
              key={item}
              className="autocomplete-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                applyTag(item);
                setOpen(false);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function disabledHealthForSite(site) {
  return {
    local: { online: false, error: 'disabled', disabled: true, host: '', port: 0 },
  };
}

function pendingHealthForSite(site, currentHealth = {}) {
  return {
    local: { ...(currentHealth?.local || {}), online: false, pending: true, error: 'updating' },
  };
}

function siteImportNames(site) {
  return [...new Set([...(site.imports || []).map((item) => item.name), ...((site.proxies?.[0]?.imports || []).map((item) => item.name))])];
}

function nonEditableDirectiveNames(site) {
  return (site.directives || [])
    .map((directive) => directive.name)
    .filter((name) => !['import', 'log'].includes(name));
}

function isStandardProxySite(site) {
  if (!site) return false;
  if ((site.addresses || []).length !== 1) return false;
  if ((site.proxies || []).length !== 1) return false;
  if ((site.handles || []).length > 0) return false;
  if ((site.matchers || []).length > 0) return false;
  if ((site.forwardAuth || []).length > 0) return false;
  if (nonEditableDirectiveNames(site).length > 0) return false;
  const proxy = site.proxies?.[0];
  if (!proxy) return false;
  if (proxy.context === 'handle' || proxy.matcher) return false;
  return true;
}

function advancedSiteReason(site) {
  if ((site.handles || []).length > 0) return 'Contains handle blocks and multiple routing branches.';
  if ((site.matchers || []).length > 0) return 'Contains named matchers outside the simple proxy layout.';
  if ((site.forwardAuth || []).length > 0) return 'Contains forward_auth directives that need raw editing.';
  if ((site.proxies || []).length !== 1) return 'Contains multiple reverse_proxy directives.';
  if ((site.addresses || []).length !== 1) return 'Contains multiple site addresses.';
  const directives = nonEditableDirectiveNames(site);
  if (directives.length > 0) return `Contains extra directives: ${directives.slice(0, 3).join(', ')}.`;
  const proxy = site.proxies?.[0];
  if (proxy?.context === 'handle' || proxy?.matcher) return 'Contains matcher-specific proxy routing.';
  return 'This proxy needs raw config editing.';
}

export default function Proxies({
  config,
  refresh,
  refreshHealth,
  setConfig,
  canEdit,
  theme,
  health,
  loading,
  api,
  templates = [],
  templateToApply = null,
  onTemplateApplied,
  onConfigChanged,
  onHealthPatch,
  notify,
}) {
  const empty = { host: '', upstream: '', description: '', category: '', tags: '', imports: '', logMode: 'none', logPath: '' };
  const [form, setForm] = useState(empty);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [edit, setEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('domain');
  const [sectionSorts, setSectionSorts] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingToggleLine, setPendingToggleLine] = useState('');
  const [renderLimits, setRenderLimits] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);

  const sites = config?.parsed?.sites || [];
  const snippets = config?.parsed?.snippets || [];
  const deferredSearch = useDeferredValue(search);
  const query = deferredSearch.trim().toLowerCase();
  const standardCount = useMemo(() => sites.filter((site) => isStandardProxySite(site)).length, [sites]);
  const advancedCount = sites.length - standardCount;

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      if (!query) return true;
      return [
        site.addresses.join(' '),
        site.proxies.map((proxy) => proxy.upstreams.join(' ')).join(' '),
        site.imports.map((i) => i.name).join(' '),
        (site.proxies[0]?.imports || []).map((i) => i.name).join(' '),
        rootDomain(site.addresses?.[0]),
        site.description || '',
        (site.tags || []).join(' '),
        site.category || '',
        advancedSiteReason(site),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [query, sites]);

  const groupedEntries = useMemo(() => {
    const groups = new Map();
    for (const site of filteredSites) {
      const key = viewMode === 'category' ? (site.category || 'Uncategorized') : rootDomain(site.addresses?.[0]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(site);
    }
    return [...groups.entries()]
      .sort((a, b) => compareText(a[0], b[0]))
      .map(([groupName, items]) => {
        const sectionKey = proxySectionKey(viewMode, groupName);
        const sectionSort = sectionSorts[sectionKey] || defaultSectionSort;
        return [groupName, [...items].sort((a, b) => sortSites(a, b, sectionSort, health))];
      });
  }, [filteredSites, sectionSorts, health, viewMode]);

  useEffect(() => {
    const initial = Object.fromEntries(groupedEntries.map(([name]) => [name, 14]));
    setRenderLimits(initial);
    if (!groupedEntries.length) return;
    const timer = setInterval(() => {
      setRenderLimits((current) => {
        let changed = false;
        const next = { ...current };
        for (const [name, items] of groupedEntries) {
          const cur = next[name] || 0;
          if (cur < items.length) {
            next[name] = Math.min(items.length, cur + 18);
            changed = true;
          }
        }
        if (!changed) clearInterval(timer);
        return changed ? next : current;
      });
    }, 80);
    return () => clearInterval(timer);
  }, [groupedEntries]);

  const domains = useMemo(
    () =>
      [...new Set(sites.map((site) => rootDomain(site.addresses?.[0])).filter(Boolean))]
        .sort((a, b) => compareText(a, b)),
    [sites]
  );

  const allTags = useMemo(() => {
    const unique = new Set();
    for (const site of sites) for (const tag of site.tags || []) unique.add(tag);
    return [...unique].sort((a, b) => compareText(a, b));
  }, [sites]);

  const categories = useMemo(() => {
    const unique = new Set();
    for (const site of sites) if (site.category) unique.add(site.category);
    return [...unique].sort((a, b) => compareText(a, b));
  }, [sites]);

  const templateMap = useMemo(
    () => new Map((templates || []).map((template) => [String(template.id || ''), template])),
    [templates]
  );

  const applyTemplateToForm = (template) => {
    if (!template) return;
    const logging = normalizeLogging(template.logging || {});
    setForm((current) => ({
      ...current,
      host: template.host || '',
      upstream: template.upstream || '',
      description: template.description || '',
      category: template.category || '',
      tags: (template.tags || []).join(', '),
      imports: (template.imports || []).join(', '),
      logMode: logging.mode || 'none',
      logPath: logging.path || '',
    }));
  };

  useEffect(() => {
    if (!selectedTemplateId) return;
    if (templateMap.has(selectedTemplateId)) return;
    setSelectedTemplateId('');
  }, [selectedTemplateId, templateMap]);

  useEffect(() => {
    if (!templateToApply?.id) return;
    const template = templateMap.get(String(templateToApply.id)) || templateToApply;
    applyTemplateToForm(template);
    setSelectedTemplateId(String(template.id || ''));
    onTemplateApplied?.();
  }, [templateToApply?.nonce, templateToApply?.id, templateMap, onTemplateApplied]);

  useEffect(() => {
    if (localTest) return undefined;
    const id = setInterval(() => refreshHealth?.(), HEALTH_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshHealth]);

  const applyLocal = (content) => {
    setConfig({
      path: config?.path || 'Caddyfile',
      content,
      parsed: parseCaddyfile(content),
      health: config?.health || {},
    });
  };

  const metadataOnlyEdit = (draft) => {
    if (!draft?.baseline) return false;
    const baseline = draft.baseline;
    return (
      String(draft.host || '').trim() === baseline.host &&
      String(draft.upstream || '').trim() === baseline.upstream &&
      selectedImportNames(draft.imports).join(',') === baseline.imports &&
      String(draft.logMode || 'none') === baseline.logMode &&
      String(draft.logPath || '').trim() === baseline.logPath &&
      Boolean(draft.disabled) === baseline.disabled
    );
  };

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        host: form.host,
        upstream: form.upstream,
        description: form.description,
        category: form.category,
        imports: selectedImportNames(form.imports),
        tags: selectedTagNames(form.tags),
        logging: { mode: form.logMode, path: form.logPath },
      };
      if (localTest) {
        applyLocal(appendSimpleProxy(config.content, payload));
        setForm(empty);
        return;
      }
      const data = await api('/api/proxies', { method: 'POST', body: JSON.stringify(payload) });
      setConfig((current) => ({ ...current, content: data.content, parsed: data.parsed, health: data.health || current.health }));
      onConfigChanged?.('Proxy added.', data.event || null);
      setForm(empty);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setError('');
    try {
      if (edit.rawOpen) {
        const nextContent = replaceBlockAtLine(config.content, edit.line, edit.rawBlock);
        if (localTest) {
          applyLocal(nextContent);
          setEdit(null);
          return;
        }
        const data = await api('/api/config', {
          method: 'POST',
          body: JSON.stringify({ content: nextContent, validate: true }),
        });
        setConfig((current) => ({ ...current, content: nextContent, parsed: data.parsed, health: data.health || current.health }));
        onConfigChanged?.('Proxy updated.', data.event || null);
        setEdit(null);
        return;
      }
      const payload = {
        host: edit.host,
        upstream: edit.upstream,
        description: edit.description,
        category: edit.category,
        imports: selectedImportNames(edit.imports),
        tags: selectedTagNames(edit.tags),
        logging: { mode: edit.logMode, path: edit.logPath },
        disabled: Boolean(edit.disabled),
      };
      if (localTest) {
        applyLocal(updateSimpleProxy(config.content, { siteLine: edit.line, ...payload }));
        setEdit(null);
        return;
      }
      const data = await api(`/api/proxies/${edit.line}`, { method: 'PUT', body: JSON.stringify(payload) });
      setConfig((current) => ({ ...current, content: data.content, parsed: data.parsed, health: data.health || current.health }));
      const metadataOnly = metadataOnlyEdit(edit);
      onConfigChanged?.(metadataOnly ? 'Proxy metadata saved.' : 'Proxy updated.', data.event || null, metadataOnly ? { skipReloadWarning: true } : undefined);
      setEdit(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (site) => {
    if (!isStandardProxySite(site)) {
      setEdit({
        line: site.line,
        advanced: true,
        rawOpen: true,
        rawBlock: readBlockAtLine(config.content, site.line),
        host: site.addresses[0] || '',
        reason: advancedSiteReason(site),
        imports: siteImportNames(site).join(', '),
      });
      return;
    }
    const names = [...site.imports, ...(site.proxies[0]?.imports || [])].map((item) => item.name);
    const logging = normalizeLogging(site.logging);
    setEdit({
      line: site.line,
      host: site.addresses[0] || '',
      upstream: site.proxies[0]?.upstreams?.join(' ') || '',
      description: site.description || '',
      category: site.category || '',
      tags: (site.tags || []).join(', '),
      imports: [...new Set(names)].join(', '),
      logMode: logging.mode,
      logPath: logging.path,
      disabled: Boolean(site.disabled),
      rawOpen: false,
      rawBlock: readBlockAtLine(config.content, site.line),
      baseline: {
        host: site.addresses[0] || '',
        upstream: site.proxies[0]?.upstreams?.join(' ') || '',
        imports: [...new Set(names)].join(','),
        logMode: logging.mode,
        logPath: logging.path || '',
        disabled: Boolean(site.disabled),
      },
    });
  };

  const deleteProxy = async (site) => {
    setBusy(true);
    setError('');
    try {
      if (localTest) {
        const lines = config.content.replace(/\r\n/g, '\n').split('\n');
        const start = site.line - 1;
        let depth = 0;
        let end = start;
        for (let i = start; i < lines.length; i += 1) {
          for (const ch of lines[i]) {
            if (ch === '{') depth += 1;
            if (ch === '}') depth -= 1;
          }
          if (depth === 0) {
            end = i;
            break;
          }
        }
        lines.splice(start, end - start + 1);
        applyLocal(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
        return;
      }
      const data = await api(`/api/proxies/${site.line}`, { method: 'DELETE' });
      setConfig((current) => ({ ...current, content: data.content, parsed: data.parsed, health: data.health || current.health }));
      onConfigChanged?.('Proxy deleted.', data.event || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  };

  const toggleDisabled = async (site) => {
    const pendingKey = String(site.line);
    if (pendingToggleLine === pendingKey) return;
    setPendingToggleLine(pendingKey);
    setError('');
    try {
      const disabled = !site.disabled;
      if (localTest) {
        applyLocal(setProxyDisabled(config.content, { siteLine: site.line, disabled }));
        onHealthPatch?.({ [site.id]: disabled ? disabledHealthForSite(site) : pendingHealthForSite(site, health?.[site.id]) });
        return;
      }
      setConfig((current) => {
        if (!current?.parsed) return current;
        return {
          ...current,
          content: setProxyDisabled(current.content, { siteLine: site.line, disabled }),
          parsed: {
            ...current.parsed,
            sites: (current.parsed.sites || []).map((entry) => (
              entry.id === site.id
                ? {
                  ...entry,
                  disabled,
                  proxies: (entry.proxies || []).map((proxy) => ({ ...proxy, disabled })),
                }
                : entry
            )),
          },
        };
      });
      onHealthPatch?.({ [site.id]: disabled ? disabledHealthForSite(site) : pendingHealthForSite(site, health?.[site.id]) });
      const data = await api(`/api/proxies/${site.line}/disabled`, { method: 'POST', body: JSON.stringify({ disabled }) });
      setConfig((current) => ({ ...current, content: data.content, parsed: data.parsed, health: data.health || current.health }));
      if (data.health) onHealthPatch?.(data.health);
      onConfigChanged?.(disabled ? 'Proxy disabled.' : 'Proxy enabled.', data.event || null);
    } catch (err) {
      refresh?.();
      setError(err.message);
    } finally {
      setPendingToggleLine('');
    }
  };

  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleSelect = (siteId) => {
    setSelectedIds((prev) => (prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]));
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const selectAllVisible = (visible) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const site of visible || []) next.add(site.id);
      return [...next];
    });
  };

  const bulkDisable = async (targetDisabled) => {
    if (busy) return;
    if (selectedIds.length === 0) return;
    const snapshot = [...selectedIds];
    setSelectedIds((prev) => prev.filter((id) => !snapshot.includes(id)));
    setBusy(true);
    setError('');
    try {
      const lineLookup = new Map((sites || []).map((site) => [site.id, site.line]));
      const actions = snapshot
        .map((id) => ({ line: lineLookup.get(id), disabled: targetDisabled }))
        .filter((action) => action.line !== undefined && action.line !== null);
      if (actions.length === 0) {
        throw new Error('No matching proxies to update.');
      }
      const res = await api('/api/proxies/bulk-disabled', {
        method: 'POST',
        body: JSON.stringify({ actions }),
      });
      if (res.content !== undefined) {
        setConfig((current) => ({ ...current, content: res.content, parsed: res.parsed || current.parsed }));
      }
      if (res.health) onHealthPatch?.(res.health);
      notify?.({ ok: true, message: `${res.applied ?? actions.length} proxies ${targetDisabled ? 'disabled' : 'enabled'}` });
    } catch (err) {
      setSelectedIds(snapshot);
      setError(err.message);
      notify?.({ ok: false, message: `Bulk ${targetDisabled ? 'disable' : 'enable'} failed: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (busy) return;
    if (selectedIds.length === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selectedIds.length} selected proxies?`)) return;
    const snapshot = [...selectedIds];
    setSelectedIds((prev) => prev.filter((id) => !snapshot.includes(id)));
    setBusy(true);
    setError('');
    try {
      const lineLookup = new Map((sites || []).map((site) => [site.id, site.line]));
      const lines = snapshot
        .map((id) => lineLookup.get(id))
        .filter((line) => line !== undefined && line !== null);
      if (lines.length === 0) {
        throw new Error('No matching proxies to delete.');
      }
      const res = await api('/api/proxies/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ lines }),
      });
      if (res.content !== undefined) {
        setConfig((current) => ({ ...current, content: res.content, parsed: res.parsed || current.parsed }));
      }
      if (res.health) onHealthPatch?.(res.health);
      notify?.({ ok: true, message: `${res.applied ?? lines.length} proxies deleted` });
    } catch (err) {
      setSelectedIds(snapshot);
      setError(err.message);
      notify?.({ ok: false, message: `Bulk delete failed: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const toggleSort = (sectionKey, key) => {
    setSectionSorts((current) => {
      const active = current[sectionKey] || defaultSectionSort;
      return {
        ...current,
        [sectionKey]: active.key === key ? { key, dir: active.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
      };
    });
  };

  const sectionSortFor = (sectionKey) => sectionSorts[sectionKey] || defaultSectionSort;
  const sortArrow = (sectionKey, key) => {
    const active = sectionSortFor(sectionKey);
    return active.key !== key ? '' : active.dir === 'asc' ? ' ▲' : ' ▼';
  };
  const sectionLabel = viewMode === 'category' ? 'category' : 'domain';

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Proxies</h2>
          <p>Grouped by {sectionLabel}.</p>
        </div>
        <div className="toolbar">
          <label>
            View
            <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
              <option value="domain">Sections by domain</option>
              <option value="category">Sections by category</option>
            </select>
          </label>
          <button onClick={refresh}><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>

      <StatCards parsed={config?.parsed} />

      {loading && (
        <div className="proxy-loading">
          <div className="proxy-row-skeleton"><span /><span /><span /><span /><span /><span /><span /></div>
          <div className="proxy-row-skeleton"><span /><span /><span /><span /><span /><span /><span /></div>
          <div className="proxy-row-skeleton"><span /><span /><span /><span /><span /><span /><span /></div>
        </div>
      )}

      <div className="proxy-search">
        <input placeholder="Search proxies" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span>{filteredSites.length} shown</span>
        <span>{standardCount} standard</span>
        <span>{advancedCount} advanced</span>
      </div>

      {selectedIds.length > 0 && (
        <div className="bulk-action-bar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-action-count">{selectedIds.length} selected</span>
          <button type="button" onClick={() => bulkDisable(false)} disabled={busy}>
            <Power size={14} /> Enable
          </button>
          <button type="button" onClick={() => bulkDisable(true)} disabled={busy}>
            <Power size={14} /> Disable
          </button>
          <button type="button" onClick={bulkDelete} disabled={busy} className="danger">
            <Trash2 size={14} /> Delete
          </button>
          <button type="button" onClick={clearSelection} disabled={busy}>Clear selection</button>
        </div>
      )}

      {error && <Notice type="error">{error}</Notice>}

      {canEdit && (
        <form className="quick-add" onSubmit={add}>
          <div className="proxy-template-picker">
            <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
              <option value="">Select template...</option>
              {templates
                .slice()
                .sort((a, b) => compareText(a.name, b.name))
                .map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => applyTemplateToForm(templateMap.get(selectedTemplateId))}
              disabled={!selectedTemplateId}
            >
              <Wand2 size={16} />Apply template
            </button>
          </div>
          <input list="proxy-domain-suggestions" placeholder="new.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          <datalist id="proxy-domain-suggestions">
            {domains.flatMap((domain) => [`caddyui.${domain}`, `app.${domain}`, domain]).map((host) => <option key={host} value={host} />)}
          </datalist>
          <input placeholder="http://10.0.0.10:3000" value={form.upstream} onChange={(e) => setForm({ ...form, upstream: e.target.value })} />
          <input className="proxy-description-input" placeholder="short description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <AutoCompleteInput
            value={form.category}
            placeholder="category"
            suggestions={categories}
            onChange={(next) => setForm({ ...form, category: next })}
          />
          <TagAutoCompleteInput
            value={form.tags}
            placeholder="tags: prod, internal"
            suggestions={allTags}
            onChange={(next) => setForm({ ...form, tags: next })}
          />
          <select value={form.logMode} onChange={(e) => setForm({ ...form, logMode: e.target.value })}>
            <option value="none">No access log</option>
            <option value="default">Default log</option>
            <option value="stdout">Log to stdout</option>
            <option value="stderr">Log to stderr</option>
            <option value="file">Log to file</option>
          </select>
          {form.logMode === 'file' && <input placeholder="/var/log/caddy/site.access.log" value={form.logPath} onChange={(e) => setForm({ ...form, logPath: e.target.value })} />}
          <button className="primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Wand2 size={16} />}Add proxy</button>
          <MiddlewarePicker snippets={snippets} value={form.imports} onChange={(imports) => setForm({ ...form, imports })} />
        </form>
      )}

      {edit && (
        <div className="modal-backdrop" onMouseDown={() => setEdit(null)}>
          <form className="edit-modal proxy-edit-modal" onSubmit={saveEdit} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{edit.advanced ? 'Advanced proxy editor' : 'Edit proxy'}</h3>
              <button type="button" onClick={() => setEdit(null)}>Close</button>
            </div>
            {edit.advanced ? (
              <>
                <div className="proxy-advanced-meta">
                  <div className="proxy-edit-card">
                    <h4>Why advanced mode</h4>
                    <p>{edit.reason}</p>
                    <div className="proxy-advanced-details">
                      <span><b>Host</b>{edit.host || 'n/a'}</span>
                      <span><b>Imports</b>{edit.imports || 'none'}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
            <div className="proxy-edit-layout">
              <section className="proxy-edit-card">
                <h4>Connection</h4>
                <label>
                  Host
                  <input value={edit.host} onChange={(e) => { const next = { ...edit, host: e.target.value }; if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next); setEdit(next); }} />
                </label>
                <label>
                  Upstream
                  <input value={edit.upstream} onChange={(e) => { const next = { ...edit, upstream: e.target.value }; if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next); setEdit(next); }} />
                </label>
                <label>
                  Description
                  <textarea rows="3" value={edit.description} onChange={(e) => { const next = { ...edit, description: e.target.value }; if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next); setEdit(next); }} placeholder="What this proxy is for" />
                </label>
              </section>
              <section className="proxy-edit-card">
                <h4>Organization</h4>
                <label>
                  Category
                  <AutoCompleteInput
                    value={edit.category}
                    suggestions={categories}
                    onChange={(value) => {
                      const next = { ...edit, category: value };
                      if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next);
                      setEdit(next);
                    }}
                  />
                </label>
                <label>
                  Tags
                  <TagAutoCompleteInput
                    value={edit.tags}
                    placeholder="prod, internal"
                    suggestions={allTags}
                    onChange={(value) => {
                      const next = { ...edit, tags: value };
                      if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next);
                      setEdit(next);
                    }}
                  />
                </label>
                <div className="proxy-edit-card proxy-edit-card-compact">
                  <h4>Middleware</h4>
                  <MiddlewarePicker snippets={snippets} value={edit.imports} onChange={(imports) => { const next = { ...edit, imports }; if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next); setEdit(next); }} />
                </div>
              </section>
              <section className="proxy-edit-card">
                <h4>Logging</h4>
                <label>
                  Logging
                  <select value={edit.logMode} onChange={(e) => { const next = { ...edit, logMode: e.target.value }; if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next); setEdit(next); }}>
                    <option value="none">No access log</option>
                    <option value="default">Default log</option>
                    <option value="stdout">Log to stdout</option>
                    <option value="stderr">Log to stderr</option>
                    <option value="file">Log to file</option>
                  </select>
                </label>
                {edit.logMode === 'file' && (
                  <label>
                    Log file
                    <input value={edit.logPath} onChange={(e) => { const next = { ...edit, logPath: e.target.value }; if (next.rawOpen) next.rawBlock = previewProxyBlock(config.content, next); setEdit(next); }} />
                  </label>
                )}
              </section>
            </div>
            )}
            {!edit.advanced && (
            <button type="button" className="expand-toggle" onClick={() => { const nextOpen = !edit.rawOpen; const next = { ...edit, rawOpen: nextOpen }; if (nextOpen) next.rawBlock = previewProxyBlock(config.content, next); setEdit(next); }}>
              {edit.rawOpen ? 'Hide raw config' : 'Edit raw config'}
            </button>
            )}
            {edit.advanced ? (
              <div className="raw-proxy-editor">
                <Editor height="420px" defaultLanguage="caddyfile" theme={theme === 'light' ? 'light' : 'vs-dark'} value={edit.rawBlock} onChange={(value) => setEdit({ ...edit, rawBlock: value || '' })} options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false }} />
              </div>
            ) : edit.rawOpen && (
              <div className="raw-proxy-editor">
                <Editor height="360px" defaultLanguage="caddyfile" theme={theme === 'light' ? 'light' : 'vs-dark'} value={edit.rawBlock} onChange={(value) => setEdit({ ...edit, rawBlock: value || '' })} options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false }} />
              </div>
            )}
            <div className="toolbar">
              <button className="primary" disabled={busy}>Save</button>
              <button type="button" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal confirm={confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={() => confirmDelete?.action()} />

      <div className="proxy-list">
        {groupedEntries.map(([groupName, items]) => {
          const sectionKey = `${viewMode}:${groupName}`;
          const sectionSort = sectionSortFor(sectionKey);
          const sectionSelectedCount = items.reduce((sum, site) => (selectedIdsSet.has(site.id) ? sum + 1 : sum), 0);
          const allInSectionSelected = items.length > 0 && sectionSelectedCount === items.length;
          const someInSectionSelected = sectionSelectedCount > 0 && sectionSelectedCount < items.length;
          return (
            <details
              className="proxy-group"
              key={sectionKey}
              open={!collapsedSections[sectionKey]}
              onToggle={(e) => {
                const isOpen = e.currentTarget?.open ?? true;
                setCollapsedSections((current) => ({ ...current, [sectionKey]: !isOpen }));
              }}
            >
              <summary className="proxy-group-head">
                <h3>{groupName}</h3>
                <span>{items.length} entries</span>
              </summary>
              <div className="proxy-table-head-row">
                {canEdit && (
                  <span className="proxy-checkbox-cell">
                    <input
                      type="checkbox"
                      checked={allInSectionSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someInSectionSelected && !allInSectionSelected;
                      }}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (e.target.checked) selectAllVisible(filteredSites);
                        else clearSelection();
                      }}
                      aria-label="Select all visible"
                    />
                  </span>
                )}
                <div className="proxy-table-head">
                  <button type="button" className={`table-sort ${sectionSort.key === 'host' ? 'active' : ''}`} onClick={() => toggleSort(sectionKey, 'host')}>Host{sortArrow(sectionKey, 'host')}</button>
                  <button type="button" className={`table-sort ${sectionSort.key === 'upstream' ? 'active' : ''}`} onClick={() => toggleSort(sectionKey, 'upstream')}>Upstream{sortArrow(sectionKey, 'upstream')}</button>
                  <button type="button" className={`table-sort ${sectionSort.key === 'local' ? 'active' : ''}`} onClick={() => toggleSort(sectionKey, 'local')}>Local{sortArrow(sectionKey, 'local')}</button>
                  <button type="button" className={`table-sort ${sectionSort.key === 'category' ? 'active' : ''}`} onClick={() => toggleSort(sectionKey, 'category')}>Category{sortArrow(sectionKey, 'category')}</button>
                  <button type="button" className={`table-sort ${sectionSort.key === 'tags' ? 'active' : ''}`} onClick={() => toggleSort(sectionKey, 'tags')}>Tags{sortArrow(sectionKey, 'tags')}</button>
                  <button type="button" className={`table-sort ${sectionSort.key === 'imports' ? 'active' : ''}`} onClick={() => toggleSort(sectionKey, 'imports')}>Imports{sortArrow(sectionKey, 'imports')}</button>
                  <span>Actions</span>
                </div>
              </div>
              {items.slice(0, renderLimits[groupName] || 0).map((site) => (
                <ProxyRow
                  key={site.id}
                  site={site}
                  healthCheck={health?.[site.id]?.local}
                  canEdit={canEdit}
                  selected={selectedIdsSet}
                  onToggleSelect={toggleSelect}
                  onToggleDisabled={() => toggleDisabled(site)}
                  onEdit={() => startEdit(site)}
                  onDelete={(e) => setConfirmDelete(deleteConfirm(e, 'Delete proxy', site.addresses[0], () => deleteProxy(site)))}
                />
              ))}
              {(renderLimits[groupName] || 0) < items.length && <div className="proxy-row-skeleton"><span /><span /><span /><span /><span /><span /><span /><span /></div>}
            </details>
          );
        })}
      </div>
    </section>
  );
}
