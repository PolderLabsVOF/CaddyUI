import React, { useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Copy, LayoutTemplate, Layers3, Plus, Search, Sparkles } from 'lucide-react';
import { parseCaddyfile } from '../../server/caddyParser.js';
import { ConfirmModal, Notice, deleteConfirm, findBlockRange } from '../components/common.jsx';

const localTest = import.meta.env.DEV && import.meta.env.VITE_CADDYUI_LOCAL_TEST === '1';

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
};

const middlewareTemplates = [
  {
    key: 'security-headers',
    label: 'Security headers',
    name: 'security_headers',
    scope: 'site',
    body: `header {
\tX-Frame-Options "DENY"
\tX-Content-Type-Options "nosniff"
\tReferrer-Policy "strict-origin-when-cross-origin"
}`,
  },
  {
    key: 'forward-auth',
    label: 'Forward auth',
    name: 'forward_auth_guard',
    scope: 'site',
    body: `forward_auth 127.0.0.1:9091 {
\turi /api/authz/forward-auth
\tcopy_headers Remote-User Remote-Groups Remote-Name Remote-Email
}`,
  },
  {
    key: 'cors',
    label: 'CORS',
    name: 'cors_headers',
    scope: 'site',
    body: `header {
\tAccess-Control-Allow-Origin "*"
\tAccess-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
\tAccess-Control-Allow-Headers "*"
}`,
  },
  {
    key: 'proxy-headers',
    label: 'Proxy headers',
    name: 'proxy_headers',
    scope: 'proxy',
    body: `header_up Host {http.request.host}
header_up X-Forwarded-Proto {http.request.scheme}
header_up X-Forwarded-For {http.request.remote.host}`,
  },
];

const middlewareHelpers = [
  {
    key: 'header-block',
    label: 'Header block',
    body: `header {
\tCache-Control "no-store"
}`,
  },
  {
    key: 'handle-options',
    label: 'OPTIONS responder',
    body: `@preflight method OPTIONS
handle @preflight {
\trespond "" 204
}`,
  },
  {
    key: 'rewrite',
    label: 'Rewrite',
    body: `rewrite * /index.html`,
  },
  {
    key: 'header-up',
    label: 'header_up',
    body: `header_up X-Forwarded-Host {http.request.host}`,
  },
];

function normalizeEditorBody(value = '') {
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const content = lines.filter((line) => line.trim().length > 0);
  if (!content.length) return '';
  const minIndent = content.reduce((min, line) => {
    const indent = (line.match(/^\s*/) || [''])[0].length;
    return Math.min(min, indent);
  }, Number.POSITIVE_INFINITY);
  return lines.map((line) => (line.trim().length ? line.slice(minIndent) : '')).join('\n');
}

function localSnippetBlock(name, body) {
  const normalized = normalizeEditorBody(body);
  const lines = normalized
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `\t${line}`)
    .join('\n');
  return `(${name}) {\n${lines}\n}`;
}

function snippetPreview(name, body) {
  const safeName = String(name || '').trim() || 'middleware_name';
  return localSnippetBlock(safeName, body);
}

function snippetScope(snippet) {
  const names = [
    ...(snippet?.forwardAuth || []).map(() => 'forward_auth'),
    ...((snippet?.directives || []).map((directive) => directive.name) || []),
  ];
  const body = String(snippet?.body || '');
  if (names.includes('forward_auth') || /\bforward_auth\b/.test(body)) return 'site';
  if (
    names.some((name) => ['header_up', 'header_down', 'method', 'rewrite', 'uri', 'transport'].includes(name) || name.startsWith('lb_')) ||
    /\bheader_up\b|\bheader_down\b|\btransport\b/.test(body)
  ) {
    return 'proxy';
  }
  return 'site';
}

function snippetDirectiveSummary(snippet) {
  const names = [
    ...(snippet?.forwardAuth?.length ? ['forward_auth'] : []),
    ...((snippet?.directives || []).map((directive) => directive.name) || []),
  ];
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return 'custom block';
  return unique.slice(0, 4).join(', ');
}

function appendBodySegment(body = '', segment = '') {
  const current = normalizeEditorBody(body);
  const next = normalizeEditorBody(segment);
  if (!next) return current;
  return current ? `${current}\n\n${next}` : next;
}

function buildDraftFromSnippet(snippet) {
  return {
    line: snippet.line,
    name: snippet.name,
    body: normalizeEditorBody(snippet.body),
    inferredType: snippet.inferredType,
    usedBy: snippet.usedBy || [],
    scope: snippetScope(snippet),
    tab: 'compose',
  };
}

function nextDuplicateName(name, snippets) {
  const existing = new Set(snippets.map((snippet) => String(snippet.name || '').toLowerCase()));
  const base = `${String(name || '').trim() || 'middleware'}-copy`;
  if (!existing.has(base.toLowerCase())) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`.toLowerCase())) index += 1;
  return `${base}-${index}`;
}

function filterSnippet(snippet, query, typeFilter, usageFilter, scopeFilter) {
  const haystack = [
    snippet.name,
    snippet.inferredType,
    snippetDirectiveSummary(snippet),
    snippetScope(snippet),
    ...(snippet.usedBy || []),
    snippet.body,
  ]
    .join(' ')
    .toLowerCase();
  const matchesQuery = !query || haystack.includes(query);
  const matchesType = typeFilter === 'all' || snippet.inferredType === typeFilter;
  const usageCount = snippet.usedBy?.length || 0;
  const matchesUsage = usageFilter === 'all' || (usageFilter === 'used' ? usageCount > 0 : usageCount === 0);
  const scope = snippetScope(snippet);
  const matchesScope = scopeFilter === 'all' || scope === scopeFilter;
  return matchesQuery && matchesType && matchesUsage && matchesScope;
}

export default function Middlewares({ config, setConfig, canEdit, theme, api, onConfigChanged }) {
  const snippets = config?.parsed?.snippets || [];
  const [edit, setEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ name: '', body: '' });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [usageFilter, setUsageFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('usage');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('blank');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creatorNameRef = useRef(null);

  const query = search.trim().toLowerCase();
  const hasActiveFilters = Boolean(query || typeFilter !== 'all' || usageFilter !== 'all' || scopeFilter !== 'all');
  const filteredSnippets = useMemo(() => {
    const items = snippets.filter((snippet) => filterSnippet(snippet, query, typeFilter, usageFilter, scopeFilter));
    return items.sort((left, right) => {
      if (sortBy === 'name') return String(left.name).localeCompare(String(right.name));
      if (sortBy === 'type') return String(left.inferredType || 'snippet').localeCompare(String(right.inferredType || 'snippet'));
      return (right.usedBy?.length || 0) - (left.usedBy?.length || 0) || String(left.name).localeCompare(String(right.name));
    });
  }, [snippets, query, typeFilter, usageFilter, scopeFilter, sortBy]);

  const summary = useMemo(() => {
    const used = snippets.filter((snippet) => (snippet.usedBy?.length || 0) > 0).length;
    const proxyScoped = snippets.filter((snippet) => snippetScope(snippet) === 'proxy').length;
    const auth = snippets.filter((snippet) => snippet.inferredType === 'auth').length;
    return {
      total: snippets.length,
      used,
      unused: snippets.length - used,
      proxyScoped,
      auth,
    };
  }, [snippets]);

  const applyLocal = (content) => {
    setConfig({
      path: config?.path || 'Caddyfile',
      content,
      parsed: parseCaddyfile(content),
      health: config?.health || {},
    });
  };

  const setSuccess = (text) => {
    setMessage(text);
    setError('');
  };

  const clearMessages = () => {
    setMessage('');
    setError('');
  };

  const applyTemplateToForm = (template) => {
    clearMessages();
    setForm({
      name: form.name.trim() ? form.name : template.name,
      body: normalizeEditorBody(template.body),
    });
    setSelectedTemplate(template.key);
  };

  const clearDraft = () => {
    clearMessages();
    setForm({ name: '', body: '' });
    setSelectedTemplate('blank');
    window.requestAnimationFrame(() => creatorNameRef.current?.focus());
  };

  const openCreator = () => {
    setCreatorOpen(true);
    window.requestAnimationFrame(() => creatorNameRef.current?.focus());
  };

  const clearFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setUsageFilter('all');
    setScopeFilter('all');
    setSortBy('usage');
  };

  const appendHelperToForm = (helper) => {
    clearMessages();
    setForm((current) => ({ ...current, body: appendBodySegment(current.body, helper.body) }));
  };

  const appendHelperToEdit = (helper) => {
    if (!edit) return;
    clearMessages();
    setEdit((current) => ({ ...current, body: appendBodySegment(current.body, helper.body) }));
  };

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    clearMessages();
    try {
      const normalizedBody = normalizeEditorBody(form.body);
      if (localTest) {
        applyLocal(`${config.content.trimEnd()}\n\n${localSnippetBlock(form.name, normalizedBody)}\n`);
        setForm({ name: '', body: '' });
        setSelectedTemplate('blank');
        setSuccess('Middleware added locally.');
        return;
      }
      const data = await api('/api/middlewares', {
        method: 'POST',
        body: JSON.stringify({ ...form, body: normalizedBody }),
      });
      setConfig((current) => ({ ...current, content: data.content, parsed: data.parsed }));
      onConfigChanged?.('Middleware added.');
      setForm({ name: '', body: '' });
      setSelectedTemplate('blank');
      setSuccess('Middleware added.');
    } catch (err) {
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    clearMessages();
    try {
      const normalizedBody = normalizeEditorBody(edit.body);
      if (localTest) {
        const range = findBlockRange(config.content, edit.line);
        const lines = config.content.replace(/\r\n/g, '\n').split('\n');
        if (range) {
          lines.splice(range.start, range.end - range.start + 1, ...localSnippetBlock(edit.name, normalizedBody).split('\n'));
        }
        applyLocal(lines.join('\n'));
        setEdit(null);
        setSuccess('Middleware updated locally.');
        return;
      }
      const data = await api(`/api/middlewares/${edit.line}`, {
        method: 'PUT',
        body: JSON.stringify({ ...edit, body: normalizedBody }),
      });
      setConfig((current) => ({ ...current, content: data.content, parsed: data.parsed }));
      onConfigChanged?.('Middleware updated.');
      setEdit(null);
      setSuccess('Middleware updated.');
    } catch (err) {
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const deleteMiddleware = async (item) => {
    setBusy(true);
    clearMessages();
    try {
      if (localTest) {
        const range = findBlockRange(config.content, item.line);
        const lines = config.content.replace(/\r\n/g, '\n').split('\n');
        if (range) lines.splice(range.start, range.end - range.start + 1);
        applyLocal(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
        setSuccess('Middleware deleted locally.');
        return;
      }
      const data = await api(`/api/middlewares/${item.line}`, { method: 'DELETE' });
      setConfig((current) => ({ ...current, content: data.content, parsed: data.parsed }));
      onConfigChanged?.('Middleware deleted.');
      setSuccess('Middleware deleted.');
    } catch (err) {
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
      setConfirmDelete(null);
      setEdit(null);
    }
  };

  const openEdit = (snippet) => {
    clearMessages();
    setEdit(buildDraftFromSnippet(snippet));
  };

  const duplicateSnippet = (snippet) => {
    clearMessages();
    setForm({
      name: nextDuplicateName(snippet.name, snippets),
      body: normalizeEditorBody(snippet.body),
    });
    setSelectedTemplate('blank');
    setEdit(null);
    setCreatorOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setSuccess(`Copied (${snippet.name}) into the create form.`);
  };

  const copyImportStatement = async (snippet) => {
    try {
      await navigator.clipboard.writeText(`import ${snippet.name}`);
      setSuccess(`Copied import ${snippet.name}.`);
    } catch {
      setError('Clipboard copy failed.');
      setMessage('');
    }
  };

  const copyDraftBlock = async () => {
    try {
      await navigator.clipboard.writeText(snippetPreview(form.name, form.body));
      setSuccess('Copied the generated middleware block.');
    } catch {
      setError('Clipboard copy failed.');
      setMessage('');
    }
  };

  return (
    <section className="middleware-page">
      <div className="section-head middleware-page-head">
        <div>
          <h2>Middlewares</h2>
          <p>Reusable Caddyfile building blocks, with clear usage and fast paths to create, inspect, and reuse each one.</p>
        </div>
        {canEdit && <button className="primary" type="button" onClick={openCreator}><Plus size={16} />New middleware</button>}
      </div>

      {message && <Notice type="success">{message}</Notice>}
      {error && <Notice type="error">{error}</Notice>}

      <div className="stats middleware-stats">
        <div><b>{summary.total}</b><span>Total snippets</span></div>
        <div><b>{summary.used}</b><span>In use</span></div>
        <div><b>{summary.proxyScoped}</b><span>Proxy-scoped</span></div>
        <div><b>{summary.auth}</b><span>Auth snippets</span></div>
      </div>

      {canEdit && !creatorOpen && (
        <section className="middleware-create-cta">
          <div><h3>Create a reusable building block</h3><p>Start from a proven template or write the directives you need. The preview always shows the exact snippet that will be saved.</p></div>
          <button type="button" onClick={openCreator}><Plus size={16} />Create middleware</button>
        </section>
      )}

      {canEdit && creatorOpen && (
        <div className="middleware-workbench">
          <form className="middleware-builder" onSubmit={add}>
            <aside className="middleware-starter-rail" aria-label="Middleware starting points">
              <div className="middleware-creator-section-head">
                <div>
                  <span className="middleware-step">1. Start</span>
                  <h3>Choose a starting point</h3>
                  <p>Use a proven pattern or start with an empty snippet.</p>
                </div>
              </div>
              <div className="middleware-starter-list">
                <button
                  type="button"
                  className={`middleware-template middleware-template-blank ${selectedTemplate === 'blank' ? 'selected' : ''}`}
                  aria-pressed={selectedTemplate === 'blank'}
                  onClick={clearDraft}
                >
                  <Plus size={16} />
                  <span>Blank middleware</span>
                  <small>write from scratch</small>
                </button>
                {middlewareTemplates.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    className={`middleware-template ${selectedTemplate === template.key ? 'selected' : ''}`}
                    aria-pressed={selectedTemplate === template.key}
                    onClick={() => applyTemplateToForm(template)}
                  >
                    <LayoutTemplate size={16} />
                    <span>{template.label}</span>
                    <small>{template.scope} middleware</small>
                  </button>
                ))}
              </div>
            </aside>

            <div className="middleware-builder-main middleware-composer">
              <div className="middleware-creator-section-head">
                <div>
                  <span className="middleware-step">2. Compose</span>
                  <h3>New middleware</h3>
                  <p>Name the reusable block, then add the Caddy directives it should contain.</p>
                </div>
                <div className="middleware-composer-actions">
                  <button type="button" onClick={() => setForm((current) => ({ ...current, body: normalizeEditorBody(current.body) }))}>
                    <Sparkles size={16} />
                    Normalize
                  </button>
                  <button type="button" onClick={() => setCreatorOpen(false)}>Close</button>
                </div>
              </div>
              <label>
                Middleware name
                <input
                  ref={creatorNameRef}
                  placeholder="security_headers"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <div className="middleware-directive-bar">
                <div>
                  <span className="middleware-step">Directives</span>
                  <p>Append a common block, then fine-tune it in the editor below.</p>
                </div>
                <div className="middleware-helper-list" aria-label="Directive helpers">
                  {middlewareHelpers.map((helper) => (
                    <button key={helper.key} type="button" onClick={() => appendHelperToForm(helper)}>
                      <Plus size={14} />{helper.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="middleware-editor middleware-editor-large">
                <Editor
                  height="390px"
                  defaultLanguage="caddyfile"
                  theme={theme === 'light' ? 'light' : 'vs-dark'}
                  value={form.body}
                  onChange={(value) => setForm({ ...form, body: value || '' })}
                  options={editorOptions}
                />
              </div>
            </div>

            <aside className="middleware-builder-side middleware-preview-card">
              <div className="middleware-creator-section-head">
                <div>
                  <span className="middleware-step">3. Review</span>
                  <h3>Generated Caddyfile</h3>
                  <p>This exact reusable block will be added to the snippet library.</p>
                </div>
                <button type="button" className="icon-button" onClick={copyDraftBlock} aria-label="Copy generated middleware block" title="Copy generated block">
                  <Copy size={16} />
                </button>
              </div>
              <pre>{snippetPreview(form.name, form.body)}</pre>
              <div className="middleware-save-panel">
                <p>{form.name.trim() && form.body.trim() ? 'Ready to add this middleware.' : 'Add a name and at least one directive to continue.'}</p>
                <button type="submit" className="primary" disabled={busy || !form.name.trim() || !form.body.trim()}>
                  <Plus size={16} />
                  {busy ? 'Adding middleware…' : 'Add middleware'}
                </button>
                <button type="button" className="middleware-clear-draft" onClick={clearDraft}>Clear draft</button>
              </div>
            </aside>
          </form>
        </div>
      )}

      <div className="proxy-search middleware-searchbar">
        <div className="middleware-search-input">
          <Search size={16} />
          <input placeholder="Search by name, directive, usage, or body" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select aria-label="Filter by middleware type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="snippet">snippet</option>
          <option value="headers">headers</option>
          <option value="auth">auth</option>
          <option value="tls">tls</option>
        </select>
        <select aria-label="Filter by middleware scope" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
          <option value="all">All scopes</option>
          <option value="site">site</option>
          <option value="proxy">proxy</option>
        </select>
        <select aria-label="Filter by middleware usage" value={usageFilter} onChange={(e) => setUsageFilter(e.target.value)}>
          <option value="all">All usage</option>
          <option value="used">In use</option>
          <option value="unused">Unused</option>
        </select>
        <select aria-label="Sort middlewares" value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="usage">Most used</option><option value="name">Name</option><option value="type">Type</option></select>
        {(search || typeFilter !== 'all' || scopeFilter !== 'all' || usageFilter !== 'all' || sortBy !== 'usage') && <button type="button" className="middleware-clear-filters" onClick={clearFilters}>Clear filters</button>}
      </div>

      <div className="middleware-results">
        <span>{filteredSnippets.length} shown · sorted by {sortBy === 'usage' ? 'usage' : sortBy}</span>
        <span>{summary.total} total</span>
        <span>{summary.unused} unused</span>
      </div>

      <div className="middleware-list middleware-library">
        <div className="middleware-table-head">
          <span>Middleware</span>
          <span>Directives</span>
          <span>Used by</span>
          <span>Scope</span>
        </div>
        {filteredSnippets.map((snippet) => {
          const scope = snippetScope(snippet);
          const usageCount = snippet.usedBy?.length || 0;
          return (
            <div
              className={`middleware-row ${canEdit ? 'clickable' : ''}`}
              key={snippet.name}
              onClick={canEdit ? () => openEdit(snippet) : undefined}
              role={canEdit ? 'button' : undefined}
              tabIndex={canEdit ? 0 : undefined}
              onKeyDown={canEdit ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openEdit(snippet);
                }
              } : undefined}
            >
              <span className="middleware-name" data-label="Name">
                <strong>({snippet.name})</strong>
                <small><span className={`middleware-chip ${snippet.inferredType || 'snippet'}`}>{snippet.inferredType || 'snippet'}</span>{usageCount > 0 ? `${usageCount} import${usageCount === 1 ? '' : 's'}` : 'unused'}</small>
              </span>
              <span className="middleware-directives" data-label="Directives">{snippetDirectiveSummary(snippet)}</span>
              <span className="middleware-usedby" data-label="Used by">{snippet.usedBy?.join(', ') || 'unused'}</span>
              <span className="middleware-scope" data-label="Scope">{scope}</span>
            </div>
          );
        })}
        {filteredSnippets.length === 0 && (
          <div className="middleware-empty">
            <h3>No middleware matches</h3>
            <p>Try loosening the filters or create a new snippet from a starter template.</p>
            {hasActiveFilters ? <button type="button" onClick={clearFilters}>Clear filters</button> : canEdit ? <button type="button" onClick={openCreator}><Plus size={16} />Create middleware</button> : null}
          </div>
        )}
      </div>

      {edit && (
        <div className="modal-backdrop" onMouseDown={() => setEdit(null)}>
          <form className="edit-modal middleware-edit-modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>Edit middleware</h3>
                <p>Manage reuse details, then edit every Caddyfile directive in the snippet body.</p>
              </div>
              <button type="button" onClick={() => setEdit(null)}>Close</button>
            </div>
            <div className="config-mode-tabs" role="tablist" aria-label="Middleware configuration"><button type="button" role="tab" aria-selected={edit.tab === 'compose'} className={edit.tab === 'compose' ? 'active' : ''} onClick={() => setEdit((current) => ({ ...current, tab: 'compose' }))}>Compose</button><button type="button" role="tab" aria-selected={edit.tab === 'reuse'} className={edit.tab === 'reuse' ? 'active' : ''} onClick={() => setEdit((current) => ({ ...current, tab: 'reuse' }))}>Reuse & actions</button><button type="button" role="tab" aria-selected={edit.tab === 'preview'} className={edit.tab === 'preview' ? 'active' : ''} onClick={() => setEdit((current) => ({ ...current, tab: 'preview' }))}>Caddyfile preview</button></div>
            <div className="middleware-edit-layout">
              {edit.tab === 'reuse' &&
              <div className="proxy-edit-card">
                <h4>Identity and reuse</h4>
                <label>
                  Name
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                </label>
                <div className="middleware-meta-grid">
                  <div>
                    <span>Type</span>
                    <b>{edit.inferredType || 'snippet'}</b>
                  </div>
                  <div>
                    <span>Scope</span>
                    <b>{edit.scope}</b>
                  </div>
                  <div>
                    <span>Used by</span>
                    <b>{edit.usedBy?.length || 0}</b>
                  </div>
                  <div>
                    <span>Directives</span>
                    <b>{snippetDirectiveSummary(edit)}</b>
                  </div>
                </div>
                <div className="middleware-usage-list">
                  <h4>Imported by</h4>
                  <p>{edit.usedBy?.join(', ') || 'Unused right now.'}</p>
                </div>
                <div className="middleware-dialog-actions"><button type="button" onClick={() => copyImportStatement(edit)}><Copy size={14} />Copy import</button><button type="button" onClick={() => duplicateSnippet(edit)}><Layers3 size={14} />Duplicate</button>{canEdit && <button type="button" className="danger" onClick={(event) => setConfirmDelete(deleteConfirm(event, 'Delete middleware', edit.name, () => deleteMiddleware(edit)))}>Delete</button>}</div>
              </div>
              }

              {edit.tab === 'compose' &&
              <div className="proxy-edit-card">
                <h4>Body</h4>
                <div className="middleware-editor-toolbar toolbar">
                  <button type="button" onClick={() => setEdit((current) => ({ ...current, body: normalizeEditorBody(current.body) }))}>
                    <Sparkles size={16} />
                    Normalize indentation
                  </button>
                  {middlewareHelpers.map((helper) => (
                    <button key={helper.key} type="button" onClick={() => appendHelperToEdit(helper)}>{helper.label}</button>
                  ))}
                </div>
                <div className="middleware-editor middleware-editor-large">
                  <Editor
                    height="420px"
                    defaultLanguage="caddyfile"
                    theme={theme === 'light' ? 'light' : 'vs-dark'}
                    value={edit.body}
                    onChange={(value) => setEdit({ ...edit, body: value || '' })}
                    options={editorOptions}
                  />
                </div>
              </div>
              }

              {edit.tab === 'preview' &&
              <div className="proxy-edit-card middleware-preview-card">
                <h4>Complete Caddyfile block</h4>
                <pre>{snippetPreview(edit.name, edit.body)}</pre>
                <p className="middleware-preview-help">The body editor accepts any valid snippet directives, not only the starter templates.</p>
              </div>
              }
            </div>
            <div className="toolbar">
              <button className="primary" disabled={busy}>Save</button>
              <button type="button" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal
        confirm={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete?.action()}
      />
    </section>
  );
}
