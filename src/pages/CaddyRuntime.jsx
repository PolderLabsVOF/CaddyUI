import React, { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  Activity,
  Box,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Gauge,
  Globe2,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { Notice } from '../components/common.jsx';

const TABS = [
  ['overview', Gauge, 'Overview'],
  ['servers', Server, 'HTTP servers'],
  ['tls', ShieldCheck, 'TLS & PKI'],
  ['observability', Activity, 'Observability'],
  ['json', Braces, 'JSON API'],
];
const PROTOCOLS = ['h1', 'h2', 'h2c', 'h3'];

function apiPath(path = []) {
  return path.length
    ? `/api/caddy/config/${path.map((part) => encodeURIComponent(String(part))).join('/')}`
    : '/api/caddy/config';
}

function compactBytes(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function durationSince(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Unavailable';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function countRoutes(server = {}) {
  return Array.isArray(server.routes) ? server.routes.length : 0;
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

export default function CaddyRuntime({ api, canEdit, canAdmin, theme, notify }) {
  const [tab, setTab] = useState('overview');
  const [config, setConfig] = useState(null);
  const [etag, setEtag] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [upstreams, setUpstreams] = useState([]);
  const [authorities, setAuthorities] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [serverEdit, setServerEdit] = useState(null);
  const [selectedPath, setSelectedPath] = useState([]);
  const [selectedEtag, setSelectedEtag] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [writeMethod, setWriteMethod] = useState('PATCH');
  const [pathResolved, setPathResolved] = useState(true);
  const [editorValue, setEditorValue] = useState('{}');
  const [editorDirty, setEditorDirty] = useState(false);
  const [treeSearch, setTreeSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [adminConnected, setAdminConnected] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const selectionRequest = useRef(0);

  const refresh = async () => {
    setBusy(true);
    setError('');
    setMetrics(null);
    setUpstreams([]);
    const [configResult, metricsResult, upstreamResult] = await Promise.allSettled([
      api('/api/caddy/config'),
      api('/api/caddy/metrics'),
      api('/api/caddy/reverse_proxy/upstreams'),
    ]);
    if (configResult.status === 'fulfilled') {
      const nextConfig = configResult.value.value || {};
      setConfig(nextConfig);
      setAdminConnected(true);
      setEtag(configResult.value.etag || '');
      if (selectedPath.length === 0) setSelectedEtag(configResult.value.etag || '');
      if (!editorDirty) setEditorValue(stringify(valueAtPath(nextConfig, selectedPath)));
    } else {
      setAdminConnected(false);
      setError(configResult.reason?.message || 'Unable to load Caddy configuration.');
    }
    if (metricsResult.status === 'fulfilled') setMetrics(metricsResult.value);
    if (upstreamResult.status === 'fulfilled') {
      const value = upstreamResult.value.value;
      setUpstreams(Array.isArray(value) ? value : Array.isArray(value?.upstreams) ? value.upstreams : []);
    }
    setLastUpdated(new Date());
    setBusy(false);
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!autoRefresh || editorDirty) return undefined;
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, editorDirty]);

  const authorityIds = Object.keys(config?.apps?.pki?.certificate_authorities || {});
  useEffect(() => {
    if (!authorityIds.length) { setAuthorities([]); return; }
    let active = true;
    Promise.all(authorityIds.map(async (id) => {
      try {
        const [info, certificates] = await Promise.all([
          api(`/api/caddy/pki/ca/${encodeURIComponent(id)}`),
          api(`/api/caddy/pki/ca/${encodeURIComponent(id)}/certificates`),
        ]);
        return { id, ok: true, info: info.value, certificates: certificates.value };
      } catch (authorityError) {
        return { id, ok: false, error: authorityError.message };
      }
    })).then((items) => { if (active) setAuthorities(items); });
    return () => { active = false; };
  }, [authorityIds.join('|')]);

  const httpApp = config?.apps?.http || {};
  const servers = httpApp.servers || {};
  const apps = Object.keys(config?.apps || {});
  const tls = config?.apps?.tls || {};
  const ech = tls.encrypted_client_hello;
  const loggers = Object.keys(config?.logging?.logs || {});
  const clearUpstreams = upstreams.filter((item) => Number(item.fails || 0) === 0).length;
  const failedUpstreams = upstreams.filter((item) => Number(item.fails || 0) > 0);
  const visibleUpstreams = failedOnly ? failedUpstreams : upstreams;
  const features = [
    ['HTTP/3', Object.values(servers).some((server) => (server.protocols || ['h1', 'h2', 'h3']).includes('h3')), 'QUIC transport'],
    ['Encrypted ClientHello', Boolean(ech?.configs?.length), ech?.configs?.length ? `${ech.configs.length} public name${ech.configs.length === 1 ? '' : 's'}` : 'Not configured'],
    ['Global DNS provider', Boolean(tls.dns), tls.dns?.name || 'Caddy default'],
    ['Events app', Boolean(config?.apps?.events), config?.apps?.events ? 'Configured' : 'Not configured'],
    ['Structured logging', loggers.length > 0, `${loggers.length} logger${loggers.length === 1 ? '' : 's'}`],
    ['Automatic HTTPS', Object.values(servers).some((server) => server.automatic_https?.disable !== true), 'Per-server policy'],
  ];

  const selectTreePath = async (path) => {
    const requestId = ++selectionRequest.current;
    setError('');
    setSelectedPath(path);
    setPathInput(path.join('/'));
    setWriteMethod('PATCH');
    setPathResolved(false);
    setEditorValue(stringify(valueAtPath(config, path)));
    setEditorDirty(false);
    setSelectedEtag('');
    try {
      const result = await api(apiPath(path));
      if (requestId !== selectionRequest.current) return;
      if (!path.length) {
        setConfig(result.value || {});
        setEtag(result.etag || '');
      }
      setEditorValue(stringify(result.value));
      setSelectedEtag(result.etag || '');
      setPathResolved(true);
    } catch (loadError) {
      if (requestId !== selectionRequest.current) return;
      if (loadError.status === 404) {
        setEditorValue('{}');
        setWriteMethod('POST');
        setPathResolved(true);
        setError('This path does not exist yet. Use Create / append to add it.');
      } else {
        setPathResolved(false);
        setError(loadError.message);
      }
    }
  };

  const saveJsonPath = async () => {
    if (!canEdit || !pathResolved) return;
    let value;
    try { value = JSON.parse(editorValue); }
    catch (parseError) { setError(`Invalid JSON: ${parseError.message}`); return; }
    setBusy(true);
    setError('');
    try {
      await api(apiPath(selectedPath), {
        method: selectedPath.length === 0 ? 'PATCH' : writeMethod,
        headers: selectedEtag ? { 'If-Match': selectedEtag } : {},
        body: JSON.stringify({ value }),
      });
      notify?.({ ok: true, level: 'success', message: `Applied ${selectedPath.length ? `/${selectedPath.join('/')}` : 'full config'} live.` });
      await refresh();
      await selectTreePath(selectedPath);
    } catch (saveError) {
      setError(saveError.status === 412 ? 'The live config changed. Refresh and reapply your edit.' : saveError.message);
    } finally { setBusy(false); }
  };

  const setManualPath = (value) => {
    selectionRequest.current += 1;
    const normalized = value.replace(/^\/?config\/?/, '').replace(/^\/+|\/+$/g, '');
    const path = normalized ? normalized.split('/').map((part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    }) : [];
    setPathInput(normalized);
    setSelectedPath(path);
    setSelectedEtag('');
    setEditorValue('{}');
    setEditorDirty(false);
    setPathResolved(false);
  };

  const deleteJsonPath = async () => {
    if (!canEdit || !pathResolved || !selectedEtag || !selectedPath.length || !window.confirm(`Delete /config/${selectedPath.join('/')} from the live config?`)) return;
    setBusy(true);
    setError('');
    try {
      await api(apiPath(selectedPath), { method: 'DELETE', headers: selectedEtag ? { 'If-Match': selectedEtag } : {} });
      notify?.({ ok: true, level: 'success', message: `Deleted /${selectedPath.join('/')} from the live config.` });
      await refresh();
      await selectTreePath([]);
    } catch (deleteError) { setError(deleteError.status === 412 ? 'The live config changed. Refresh before deleting this path.' : deleteError.message); }
    finally { setBusy(false); }
  };

  const exportConfig = () => {
    const blob = new Blob([stringify(config)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `caddy-live-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      notify?.({ ok: true, level: 'success', message: `${label} copied.` });
    } catch {
      setError(`Unable to copy ${label.toLowerCase()}. Select it manually instead.`);
    }
  };

  const formatEditor = () => {
    try {
      setEditorValue(stringify(JSON.parse(editorValue)));
      setEditorDirty(true);
      setError('');
    } catch (formatError) { setError(`Invalid JSON: ${formatError.message}`); }
  };

  const stopCaddy = async () => {
    if (!canAdmin || !window.confirm('Stop the Caddy process? Proxied services will become unavailable until Caddy is restarted.')) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/caddy/stop', { method: 'POST' });
      notify?.({ ok: true, level: 'warning', message: 'Caddy accepted the stop request.' });
    } catch (stopError) { setError(stopError.message); }
    finally { setBusy(false); }
  };

  const openServerEditor = async (name, server) => {
    let source = server;
    let pathEtag = '';
    setBusy(true);
    try {
      const result = await api(apiPath(['apps', 'http', 'servers', name]));
      if (result.value && typeof result.value === 'object') source = result.value;
      pathEtag = result.etag || '';
    } catch (loadError) {
      setError(loadError.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    setServerEdit({
      name,
      original: source,
      etag: pathEtag,
      listen: (source.listen || []).join(', '),
      protocols: source.protocols || ['h1', 'h2', 'h3'],
      read_header_timeout: source.read_header_timeout || '',
      read_timeout: source.read_timeout || '',
      write_timeout: source.write_timeout || '',
      idle_timeout: source.idle_timeout || '',
      keepalive_interval: source.keepalive_interval || '',
      keepalive_idle: source.keepalive_idle || '',
      keepalive_count: source.keepalive_count ?? '',
      max_header_bytes: source.max_header_bytes ?? '',
      strict_sni_host: source.strict_sni_host === undefined ? 'default' : String(source.strict_sni_host),
      allow_0rtt: source.allow_0rtt === undefined ? 'default' : String(source.allow_0rtt),
      enable_full_duplex: Boolean(source.enable_full_duplex),
    });
  };

  const saveServer = async (event) => {
    event.preventDefault();
    if (!serverEdit || !canEdit) return;
    const next = { ...serverEdit.original };
    const listen = serverEdit.listen.split(',').map((item) => item.trim()).filter(Boolean);
    if (listen.length) next.listen = listen; else delete next.listen;
    next.protocols = serverEdit.protocols;
    for (const key of ['read_header_timeout', 'read_timeout', 'write_timeout', 'idle_timeout', 'keepalive_interval', 'keepalive_idle']) {
      if (serverEdit[key]) next[key] = serverEdit[key]; else delete next[key];
    }
    for (const key of ['keepalive_count', 'max_header_bytes']) {
      if (serverEdit[key] !== '') next[key] = Number(serverEdit[key]); else delete next[key];
    }
    if (serverEdit.strict_sni_host !== 'default') next.strict_sni_host = serverEdit.strict_sni_host === 'true'; else delete next.strict_sni_host;
    if (serverEdit.allow_0rtt !== 'default') next.allow_0rtt = serverEdit.allow_0rtt === 'true'; else delete next.allow_0rtt;
    if (serverEdit.enable_full_duplex) next.enable_full_duplex = true; else delete next.enable_full_duplex;
    if ((next.protocols.includes('h2') || next.protocols.includes('h2c')) && !next.protocols.includes('h1')) {
      setError('Caddy requires h1 whenever h2 or h2c is enabled.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(apiPath(['apps', 'http', 'servers', serverEdit.name]), {
        method: 'PATCH',
        headers: serverEdit.etag ? { 'If-Match': serverEdit.etag } : {},
        body: JSON.stringify({ value: next }),
      });
      notify?.({ ok: true, level: 'success', message: `${serverEdit.name} applied live.` });
      setServerEdit(null);
      await refresh();
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  };

  return <section className="runtime-page">
    <div className="section-head runtime-head">
      <div><h1>Caddy runtime</h1><p>Inspect live state, manage server behavior, and make guarded JSON changes through Caddy’s Admin API.</p></div>
      <div className="runtime-head-actions"><button className={autoRefresh ? 'active' : ''} onClick={() => setAutoRefresh((current) => !current)} aria-pressed={autoRefresh}>{autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}</button><button onClick={refresh} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} />Refresh now</button></div>
    </div>
    {error && <Notice type="error">{error}</Notice>}

    <nav className="runtime-tabs" aria-label="Caddy runtime sections">
      {TABS.map(([id, Icon, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
    </nav>

    {busy && !config && <div className="runtime-loading"><Loader2 className="spin" />Connecting to Caddy’s Admin API…</div>}

    {config && tab === 'overview' && <>
      <section className="runtime-command-bar">
        <div className="runtime-connection"><span className={`runtime-dot ${adminConnected ? 'on' : ''}`} /><div><strong>{adminConnected ? 'Admin API connected' : 'Admin API unavailable'}</strong><small>{lastUpdated ? `Last checked ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Checking live state…'}{adminConnected && autoRefresh ? ' · refreshes every 15 seconds' : ''}</small></div></div>
        <div className="runtime-command-actions"><button onClick={() => { setTab('json'); selectTreePath([]); }}><Braces size={15} />Open live JSON</button><button onClick={exportConfig}><Copy size={15} />Export snapshot</button></div>
      </section>
      <div className="runtime-kpis">
        <Metric label="Loaded apps" value={apps.length} detail={apps.join(', ') || 'No apps'} />
        <Metric label="HTTP servers" value={Object.keys(servers).length} detail={`${Object.values(servers).reduce((sum, server) => sum + countRoutes(server), 0)} top-level routes`} />
        <Metric label="Upstreams clear" value={`${clearUpstreams}/${upstreams.length}`} detail="No recorded passive failures" />
        <Metric label="Process uptime" value={durationSince(metrics?.summary?.processStartTime)} detail={`${metrics?.summary?.goroutines ?? '—'} goroutines`} />
      </div>
      <div className="runtime-grid">
        <Panel title="Runtime capabilities" subtitle="Features detected in the live configuration">
          <div className="feature-list">{features.map(([name, enabled, detail]) => <div key={name}><span className={`runtime-dot ${enabled ? 'on' : ''}`} /><span><strong>{name}</strong><small>{detail}</small></span></div>)}</div>
        </Panel>
        <Panel title="Loaded app configuration" subtitle="Every configured app remains editable in the JSON API">
          <div className="module-cloud">{apps.map((name) => <button key={name} onClick={() => { setTab('json'); selectTreePath(['apps', name]); }}><Box size={14} />{name}</button>)}</div>
          {!apps.length && <p className="empty-state">No Caddy apps are loaded.</p>}
        </Panel>
        <Panel title="Configuration safety" subtitle="Live edits are protected from concurrent changes">
          <dl className="runtime-details"><div><dt>Current ETag</dt><dd className="mono">{etag || 'Not returned'}</dd></div><div><dt>Persistence</dt><dd>Admin API + caddy --resume</dd></div><div><dt>Write behavior</dt><dd>Atomic live replacement</dd></div></dl>
          <div className="runtime-actions"><button onClick={() => copyText(etag, 'ETag')} disabled={!etag}><Copy size={15} />Copy ETag</button><button onClick={() => { setTab('json'); selectTreePath([]); }}><Braces size={15} />Review full config</button></div>
          <details className="runtime-danger-zone"><summary><ShieldAlert size={15} />Danger zone</summary><p>Stopping Caddy immediately makes proxied services unavailable until the process is restarted.</p><button className="danger" onClick={stopCaddy} disabled={!canAdmin || busy}>Stop Caddy</button></details>
        </Panel>
      </div>
    </>}

    {config && tab === 'servers' && <>
      <section className="http-app-summary">
        <div><p className="eyebrow">HTTP app defaults</p><h2>Lifecycle and metrics</h2><p>Ports {httpApp.http_port || 80} / {httpApp.https_port || 443} · grace period {httpApp.grace_period || 'eternal'} · shutdown delay {httpApp.shutdown_delay || 'none'}</p></div>
        <div className="http-app-actions"><span className={`runtime-badge ${httpApp.metrics ? 'on' : ''}`}><Activity size={14} />Metrics {httpApp.metrics ? 'enabled' : 'default'}</span><button onClick={() => { setTab('json'); selectTreePath(['apps', 'http']); }}><Braces size={15} />Edit HTTP app</button></div>
      </section>
      <div className="server-cards">
      {Object.entries(servers).map(([name, server]) => <article className="server-card" key={name}>
        <div className="server-card-head"><div><span className="runtime-dot on" /><h2>{name}</h2></div><button aria-label={`Edit ${name}`} onClick={() => openServerEditor(name, server)} disabled={!canEdit}><Pencil size={15} />Edit</button></div>
        <p className="server-listen">{(server.listen || ['Caddy default listener']).join(' · ')}</p>
        <div className="protocol-list">{(server.protocols || ['h1', 'h2', 'h3']).map((protocol) => <span key={protocol}>{protocol === 'h1' ? 'HTTP/1.1' : protocol === 'h2' ? 'HTTP/2' : protocol === 'h3' ? 'HTTP/3' : 'H2C'}</span>)}</div>
        <dl className="runtime-details"><div><dt>Routes</dt><dd>{countRoutes(server)}</dd></div><div><dt>Idle timeout</dt><dd>{server.idle_timeout || '5m default'}</dd></div><div><dt>Keepalive</dt><dd>{server.keepalive_interval || '15s default'}</dd></div><div><dt>Access logs</dt><dd>{server.logs ? 'Enabled' : 'Disabled'}</dd></div></dl>
      </article>)}
      {!Object.keys(servers).length && <p className="empty-state">The HTTP app has no configured servers.</p>}
      </div>
    </>}

    {config && tab === 'tls' && <div className="runtime-grid tls-runtime-grid">
      <Panel title="TLS automation" subtitle="Certificate policy and cache configuration">
        <dl className="runtime-details"><div><dt>Automation policies</dt><dd>{tls.automation?.policies?.length || 0}</dd></div><div><dt>On-demand TLS</dt><dd>{tls.automation?.on_demand ? 'Configured' : 'Not configured'}</dd></div><div><dt>Certificate loaders</dt><dd>{Object.keys(tls.certificates || {}).join(', ') || 'Automatic'}</dd></div><div><dt>Session tickets</dt><dd>{tls.session_tickets?.disabled ? 'Disabled' : 'Enabled'}</dd></div></dl>
        <button onClick={() => { setTab('json'); selectTreePath(['apps', 'tls', 'automation']); }}><Braces size={15} />Edit automation JSON</button>
      </Panel>
      <Panel title="Encrypted ClientHello" subtitle="Caddy 2.11 automatically rotates ECH keys">
        {ech?.configs?.length ? <div className="feature-list">{ech.configs.map((item, index) => <div key={`${item.public_name}-${index}`}><span className="runtime-dot on" /><span><strong>{item.public_name}</strong><small>Managed and rotated by Caddy</small></span></div>)}</div> : <p className="empty-state">ECH is not configured. Configure a public name and DNS publication in JSON API.</p>}
        <button onClick={() => { setTab('json'); selectTreePath(['apps', 'tls', 'encrypted_client_hello']); }}><Globe2 size={15} />Configure ECH</button>
      </Panel>
      <Panel title="DNS and storage" subtitle="Global defaults for certificate operations">
        <dl className="runtime-details"><div><dt>DNS provider</dt><dd>{tls.dns?.name || 'Not configured'}</dd></div><div><dt>Resolvers</dt><dd>{tls.resolvers?.join(', ') || 'System default'}</dd></div><div><dt>Storage checks</dt><dd>{tls.disable_storage_check ? 'Disabled' : 'Enabled'}</dd></div><div><dt>Storage cleanup</dt><dd>{tls.disable_storage_clean ? 'Disabled' : 'Enabled'}</dd></div></dl>
        <button onClick={() => { setTab('json'); selectTreePath(['apps', 'tls']); }}><Braces size={15} />Edit TLS app</button>
      </Panel>
      <Panel title="Local PKI authorities" subtitle="Runtime CA state and certificate endpoints">
        {!authorityIds.length && <p className="empty-state">The PKI app has no configured certificate authorities.</p>}
        <div className="authority-list">{authorities.map((authority) => <div key={authority.id}><span className={`runtime-dot ${authority.ok ? 'on' : ''}`} /><span><strong>{authority.id}</strong><small>{authority.ok ? authority.info?.name || authority.info?.id || 'Runtime CA available' : authority.error}</small></span><button onClick={() => { setTab('json'); selectTreePath(['apps', 'pki', 'certificate_authorities', authority.id]); }}>Configure</button></div>)}</div>
        {authorityIds.length > 0 && authorities.length === 0 && <p className="empty-state"><Loader2 size={15} className="spin" />Loading authority status…</p>}
      </Panel>
    </div>}

    {config && tab === 'observability' && <div className="runtime-grid observability-grid">
      <Panel title="Runtime metrics" subtitle="Prometheus metrics from Caddy’s Admin API">
        {metrics ? <div className="runtime-kpis inline"><Metric label="Goroutines" value={metrics.summary?.goroutines ?? '—'} /><Metric label="Memory allocated" value={compactBytes(metrics.summary?.memoryBytes)} /><Metric label="Requests in flight" value={metrics.summary?.requestsInFlight ?? '—'} /><Metric label="Uptime" value={durationSince(metrics.summary?.processStartTime)} /></div> : <p className="empty-state">Metrics are unavailable. Ensure the Admin API metrics endpoint is enabled.</p>}
        {metrics?.raw && <details className="raw-metrics"><summary>Raw Prometheus output</summary><pre>{metrics.raw}</pre></details>}
      </Panel>
      <Panel title="Reverse proxy upstreams" subtitle="Live passive health and request counters">
        <div className="upstream-toolbar"><span>{failedUpstreams.length ? `${failedUpstreams.length} upstream${failedUpstreams.length === 1 ? '' : 's'} need attention` : 'All reported upstreams are clear'}</span><button className={failedOnly ? 'active' : ''} onClick={() => setFailedOnly((current) => !current)} aria-pressed={failedOnly}>{failedOnly ? 'Show all' : 'Show failures'}</button></div>
        <div className="upstream-table">{visibleUpstreams.map((upstream, index) => <div key={`${upstream.address || upstream.dial || 'upstream'}-${index}`}><span className={`runtime-dot ${Number(upstream.fails || 0) === 0 ? 'on' : ''}`} /><strong>{upstream.address || upstream.dial || 'Unnamed upstream'}</strong><span>{upstream.num_requests ?? upstream.requests ?? 0} active</span><span>{upstream.fails ?? 0} recorded failures</span></div>)}</div>
        {!upstreams.length && <p className="empty-state">No runtime upstreams were returned.</p>}
        {upstreams.length > 0 && !visibleUpstreams.length && <p className="empty-state">No upstreams with recorded failures.</p>}
      </Panel>
      <Panel title="Logging configuration" subtitle="Structured loggers and sinks">
        <div className="module-cloud">{loggers.map((name) => <button key={name} onClick={() => { setTab('json'); selectTreePath(['logging', 'logs', name]); }}>{name}</button>)}</div>
        {!loggers.length && <p className="empty-state">No global loggers are configured.</p>}
      </Panel>
    </div>}

    {config && tab === 'json' && <div className="json-workbench">
      <aside className="json-tree-panel">
        <div className="json-tree-head"><div><h2>Live configuration</h2><small>Choose any object, array, or value</small></div><span className="mono">/config/</span></div>
        <input aria-label="Search configuration keys" placeholder="Filter keys…" value={treeSearch} onChange={(event) => setTreeSearch(event.target.value)} />
        <div className="json-tree" role="tree" aria-label="Caddy configuration"><TreeNode name="root" value={config} path={[]} selectedPath={selectedPath} onSelect={selectTreePath} search={treeSearch.trim().toLowerCase()} defaultOpen /></div>
      </aside>
      <section className="json-editor-panel">
        <div className="json-editor-head"><div className="json-path-control"><p className="eyebrow">Selected API path</p><label><span>/config/</span><input aria-label="Caddy API path" value={pathInput} onChange={(event) => setManualPath(event.target.value)} placeholder="apps/http/servers/srv0" /><button type="button" onClick={() => selectTreePath(selectedPath)} disabled={busy || pathResolved}>Load</button></label></div><div><select aria-label="Write operation" value={selectedPath.length ? writeMethod : 'PATCH'} disabled={!selectedPath.length || !pathResolved} onChange={(event) => setWriteMethod(event.target.value)}><option value="PATCH">Replace</option><option value="POST">Create / append</option><option value="PUT">Insert</option></select><button onClick={() => selectTreePath(selectedPath)} disabled={!editorDirty}>Discard</button><button className="danger" onClick={deleteJsonPath} disabled={!canEdit || busy || !selectedPath.length || !pathResolved || !selectedEtag}>Delete</button><button className="primary" onClick={saveJsonPath} disabled={!canEdit || busy || !pathResolved || !editorDirty}>{busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}Save selected path</button></div></div>
        <div className="json-editor-tools"><button type="button" onClick={formatEditor} disabled={!editorDirty}>Format JSON</button><button type="button" onClick={() => copyText(editorValue, 'Selected JSON')}><Copy size={14} />Copy value</button><span>{editorDirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
        <div className="json-editor-wrap"><Editor height="560px" language="json" theme={theme === 'light' ? 'light' : 'vs-dark'} value={editorValue} onChange={(value) => { setEditorValue(value || ''); setEditorDirty(true); }} options={{ minimap: { enabled: false }, fontSize: 13, formatOnPaste: true, tabSize: 2, scrollBeyondLastLine: false, wordWrap: 'on' }} /></div>
        <p className="json-help">Replace updates an existing value. Create adds a key or appends to an array. Insert writes before an array index. Format and copy are local-only; Save selected path applies the change live.</p>
      </section>
    </div>}

    {serverEdit && <ServerEditor edit={serverEdit} setEdit={setServerEdit} canEdit={canEdit} busy={busy} onClose={() => setServerEdit(null)} onSave={saveServer} />}
  </section>;
}

function Metric({ label, value, detail }) {
  return <div className="runtime-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function Panel({ title, subtitle, children }) {
  return <section className="runtime-panel"><div className="runtime-panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>;
}

function valueAtPath(root, path) {
  return path.reduce((value, key) => value?.[key], root);
}

function TreeNode({ name, value, path, selectedPath, onSelect, search, defaultOpen = false }) {
  const expandable = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(defaultOpen || path.length < 1);
  const keys = expandable ? Object.keys(value) : [];
  const matches = !search || String(name).toLowerCase().includes(search) || keys.some((key) => key.toLowerCase().includes(search));
  if (!matches && path.length > 0) return null;
  const selected = path.length === selectedPath.length && path.every((part, index) => part === selectedPath[index]);
  return <div className="tree-node" role="treeitem" aria-expanded={expandable ? open : undefined}>
    <button className={selected ? 'selected' : ''} style={{ '--tree-depth': path.length }} onClick={() => { onSelect(path); if (expandable) setOpen((current) => !current); }}>
      {expandable ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="tree-leaf" />}
      <span>{name}</span><small>{Array.isArray(value) ? `[${value.length}]` : expandable ? `{${keys.length}}` : JSON.stringify(value)}</small>
    </button>
    {expandable && open && <div role="group">{keys.map((key) => <TreeNode key={key} name={key} value={value[key]} path={[...path, key]} selectedPath={selectedPath} onSelect={onSelect} search={search} />)}</div>}
  </div>;
}

function ServerEditor({ edit, setEdit, canEdit, busy, onClose, onSave }) {
  const update = (patch) => setEdit((current) => ({ ...current, ...patch }));
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="edit-modal server-editor" onSubmit={onSave} onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">HTTP app</p><h3>Edit {edit.name}</h3></div><button type="button" onClick={onClose}>Close</button></div>
    <div className="server-editor-grid">
      <label className="wide">Listen addresses<input value={edit.listen} onChange={(event) => update({ listen: event.target.value })} placeholder=":80, :443" /></label>
      <fieldset className="wide"><legend>Protocols</legend><div className="protocol-checks">{PROTOCOLS.map((protocol) => <label key={protocol}><input type="checkbox" checked={edit.protocols.includes(protocol)} onChange={(event) => update({ protocols: event.target.checked ? [...edit.protocols, protocol] : edit.protocols.filter((item) => item !== protocol) })} />{protocol.toUpperCase()}</label>)}</div></fieldset>
      <label>Read header timeout<input aria-label="Read header timeout" value={edit.read_header_timeout} onChange={(event) => update({ read_header_timeout: event.target.value })} placeholder="1m" /></label>
      <label>Read timeout<input value={edit.read_timeout} onChange={(event) => update({ read_timeout: event.target.value })} placeholder="No timeout" /></label>
      <label>Write timeout<input value={edit.write_timeout} onChange={(event) => update({ write_timeout: event.target.value })} placeholder="No timeout" /></label>
      <label>Idle timeout<input aria-label="Idle timeout" value={edit.idle_timeout} onChange={(event) => update({ idle_timeout: event.target.value })} placeholder="5m" /></label>
      <label>Keepalive interval<input value={edit.keepalive_interval} onChange={(event) => update({ keepalive_interval: event.target.value })} placeholder="15s" /></label>
      <label>Keepalive idle <small>Caddy 2.11</small><input value={edit.keepalive_idle} onChange={(event) => update({ keepalive_idle: event.target.value })} placeholder="15s" /></label>
      <label>Keepalive probe count <small>Caddy 2.11</small><input type="number" value={edit.keepalive_count} onChange={(event) => update({ keepalive_count: event.target.value })} placeholder="9" /></label>
      <label>Maximum header bytes<input type="number" value={edit.max_header_bytes} onChange={(event) => update({ max_header_bytes: event.target.value })} placeholder="Caddy default" /></label>
      <label>Strict SNI host<select value={edit.strict_sni_host} onChange={(event) => update({ strict_sni_host: event.target.value })}><option value="default">Automatic</option><option value="true">Required</option><option value="false">Disabled</option></select></label>
      <label>HTTP/3 0-RTT<select value={edit.allow_0rtt} onChange={(event) => update({ allow_0rtt: event.target.value })}><option value="default">Caddy default</option><option value="true">Allowed</option><option value="false">Disabled</option></select></label>
      <label className="wide toggle-line"><input type="checkbox" checked={edit.enable_full_duplex} onChange={(event) => update({ enable_full_duplex: event.target.checked })} />Enable full-duplex HTTP/1 requests</label>
    </div>
    <div className="toolbar"><button className="primary" disabled={!canEdit || busy}>{busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}Save server</button><button type="button" onClick={onClose}>Cancel</button></div>
  </form></div>;
}

export { apiPath, valueAtPath };
