import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Save, Search, Send, Trash2, Wand2 } from 'lucide-react';
import { Notice, normalizeLogging } from '../components/common.jsx';

const emptyTemplate = {
  name: '',
  description: '',
  host: '',
  upstream: '',
  category: '',
  tags: '',
  imports: '',
  logMode: 'none',
  logPath: '',
};

const compareText = (a, b) => String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase());

function parseList(text = '') {
  return [...new Set(String(text || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function templateToForm(template = null) {
  if (!template) return { ...emptyTemplate };
  return {
    name: template.name || '',
    description: template.description || '',
    host: template.host || '',
    upstream: template.upstream || '',
    category: template.category || '',
    tags: (template.tags || []).join(', '),
    imports: (template.imports || []).join(', '),
    logMode: template.logging?.mode || 'none',
    logPath: template.logging?.path || '',
  };
}

function siteToTemplateForm(site = null) {
  if (!site) return { ...emptyTemplate };
  const names = [...site.imports, ...(site.proxies?.[0]?.imports || [])].map((item) => item.name).filter(Boolean);
  const logging = normalizeLogging(site.logging || {});
  return {
    name: site.addresses?.[0] ? `${site.addresses[0]} template` : '',
    description: site.description || '',
    host: site.addresses?.[0] || '',
    upstream: site.proxies?.[0]?.upstreams?.join(' ') || '',
    category: site.category || '',
    tags: (site.tags || []).join(', '),
    imports: [...new Set(names)].join(', '),
    logMode: logging.mode,
    logPath: logging.path,
  };
}

function templateSearchText(template = {}) {
  return [
    template.name,
    template.description,
    template.host,
    template.upstream,
    template.category,
    (template.tags || []).join(' '),
    (template.imports || []).join(' '),
    template.logging?.mode || '',
    template.logging?.path || '',
  ].join(' ').toLowerCase();
}

export default function Templates({ api, canEdit, templates = [], setTemplates, config, onUseTemplate, notify }) {
  const [form, setForm] = useState({ ...emptyTemplate });
  const [editingId, setEditingId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [proxySourceLine, setProxySourceLine] = useState('');
  const [search, setSearch] = useState('');

  const proxySources = useMemo(() => {
    const sites = config?.parsed?.sites || [];
    return sites
      .filter((site) => site?.addresses?.[0] && site?.proxies?.[0]?.upstreams?.length)
      .map((site) => ({
        id: String(site.id || site.line || `${site.addresses[0]}:${site.proxies[0]?.upstreams?.[0] || ''}`),
        line: String(site.line || ''),
        host: site.addresses[0],
        upstream: site.proxies[0]?.upstreams?.join(' ') || '',
        site,
      }))
      .sort((a, b) => compareText(a.host, b.host));
  }, [config?.parsed?.sites]);

  const sortedTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...templates]
      .filter((template) => !query || templateSearchText(template).includes(query))
      .sort((a, b) => compareText(a.name, b.name));
  }, [templates, search]);

  const applyProxySource = () => {
    const source = proxySources.find((entry) => entry.line === proxySourceLine);
    if (!source) return;
    setForm((current) => ({ ...current, ...siteToTemplateForm(source.site) }));
    setFormOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        description: form.description,
        host: form.host,
        upstream: form.upstream,
        category: form.category,
        tags: parseList(form.tags),
        imports: parseList(form.imports),
        logging: {
          mode: form.logMode,
          path: form.logPath,
        },
      };
      const path = editingId ? `/api/templates/${editingId}` : '/api/templates';
      const method = editingId ? 'PUT' : 'POST';
      const result = await api(path, { method, body: JSON.stringify(payload) });
      setTemplates(result.templates || []);
      setEditingId('');
      setForm({ ...emptyTemplate });
      setProxySourceLine('');
      setFormOpen(false);
      notify?.({
        ok: true,
        message: editingId ? 'Template updated.' : 'Template created.',
        eventId: result?.event?.id || '',
      });
    } catch (err) {
      setError(err.message || 'Failed to save template.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (template) => {
    setEditingId(template.id);
    setForm(templateToForm(template));
    setFormOpen(true);
    setError('');
  };

  const cancelEdit = () => {
    setEditingId('');
    setForm({ ...emptyTemplate });
    setProxySourceLine('');
    setError('');
  };

  const removeTemplate = async (template) => {
    if (!canEdit) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(`/api/templates/${template.id}`, { method: 'DELETE' });
      setTemplates(result.templates || []);
      if (editingId === template.id) cancelEdit();
      notify?.({ ok: true, message: `Template "${template.name}" deleted.`, eventId: result?.event?.id || '' });
    } catch (err) {
      setError(err.message || 'Failed to delete template.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Templates</h2>
          <p>Reusable proxy presets for faster creation.</p>
        </div>
      </div>

      {error && <Notice type="error">{error}</Notice>}

      {canEdit && (
        <section className="template-editor-card">
          <button type="button" className="template-accordion-toggle" onClick={() => setFormOpen((open) => !open)} aria-expanded={formOpen}>
            <span>
              {editingId ? <Pencil size={18} /> : <Plus size={18} />}
              <span>
                <b>{editingId ? 'Edit template' : 'Create template'}</b>
                <small>{editingId ? 'Update a reusable proxy preset.' : 'Start blank or load fields from an existing proxy.'}</small>
              </span>
            </span>
            {formOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>

          {formOpen && (
          <form className="template-form" onSubmit={submit}>
            <div className="template-source-picker">
              <select value={proxySourceLine} onChange={(e) => setProxySourceLine(e.target.value)}>
                <option value="">Load fields from existing proxy...</option>
                {proxySources.map((source) => (
                  <option key={source.id} value={source.line}>{source.host} {'->'} {source.upstream}</option>
                ))}
              </select>
              <button type="button" onClick={applyProxySource} disabled={!proxySourceLine}>
                <Wand2 size={16} />Use proxy
              </button>
            </div>
            <label>
              Name
              <input
                placeholder="Template name"
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                required
              />
            </label>
            <label>
              Host
              <input
                placeholder="Host (optional)"
                value={form.host}
                onChange={(e) => setForm((current) => ({ ...current, host: e.target.value }))}
              />
            </label>
            <label>
              Upstream
              <input
                placeholder="http://10.0.0.10:3000"
                value={form.upstream}
                onChange={(e) => setForm((current) => ({ ...current, upstream: e.target.value }))}
              />
            </label>
            <label>
              Category
              <input
                placeholder="Category"
                value={form.category}
                onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
              />
            </label>
            <label>
              Tags
              <input
                placeholder="prod, internal"
                value={form.tags}
                onChange={(e) => setForm((current) => ({ ...current, tags: e.target.value }))}
              />
            </label>
            <label>
              Imports
              <input
                placeholder="security_headers, auth"
                value={form.imports}
                onChange={(e) => setForm((current) => ({ ...current, imports: e.target.value }))}
              />
            </label>
            <label>
              Logging
              <select value={form.logMode} onChange={(e) => setForm((current) => ({ ...current, logMode: e.target.value }))}>
                <option value="none">No access log</option>
                <option value="default">Default log</option>
                <option value="stdout">Log to stdout</option>
                <option value="stderr">Log to stderr</option>
                <option value="file">Log to file</option>
              </select>
            </label>
            {form.logMode === 'file' && (
              <label>
                Log file
                <input
                  placeholder="/var/log/caddy/site.access.log"
                  value={form.logPath}
                  onChange={(e) => setForm((current) => ({ ...current, logPath: e.target.value }))}
                />
              </label>
            )}
            <label className="template-field-wide">
              Description
              <input
                placeholder="Template description"
                value={form.description}
                onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
              />
            </label>
            <div className="template-form-actions">
              <button className="primary" disabled={busy}>
                {busy ? <Loader2 className="spin" /> : editingId ? <Save size={16} /> : <Plus size={16} />}
                {editingId ? 'Save template' : 'Create template'}
              </button>
              {editingId && <button type="button" onClick={cancelEdit}>Cancel edit</button>}
            </div>
          </form>
          )}
        </section>
      )}

      <div className="template-toolbar">
        <label className="template-search">
          <Search size={16} />
          <input placeholder="Search templates" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <span>{sortedTemplates.length} shown</span>
        <span>{templates.length} total</span>
      </div>

      <div className="template-list">
        {sortedTemplates.length === 0 && <p className="template-empty">{templates.length ? 'No templates match your search.' : 'No templates yet.'}</p>}
        {sortedTemplates.map((template) => (
          <article className="template-card" key={template.id}>
            <div className="template-card-head">
              <div>
                <h3>{template.name}</h3>
                {template.description && <p>{template.description}</p>}
              </div>
              <div className="template-card-actions">
                {canEdit && <button type="button" onClick={() => onUseTemplate?.(template)}><Send size={15} />Use</button>}
                {canEdit && <button type="button" onClick={() => startEdit(template)}><Pencil size={15} />Edit</button>}
                {canEdit && (
                  <button type="button" className="danger" onClick={() => removeTemplate(template)} disabled={busy}>
                    <Trash2 size={15} />Delete
                  </button>
                )}
              </div>
            </div>
            <div className="template-meta-grid">
              <span><b>Host</b>{template.host || 'not set'}</span>
              <span><b>Upstream</b>{template.upstream || 'not set'}</span>
              <span><b>Category</b>{template.category || 'none'}</span>
              <span><b>Tags</b>{(template.tags || []).join(', ') || 'none'}</span>
              <span><b>Imports</b>{(template.imports || []).join(', ') || 'none'}</span>
              <span><b>Logging</b>{template.logging?.mode === 'file' ? `file: ${template.logging?.path || '(no path)'}` : template.logging?.mode || 'none'}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
