import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Copy, History, Loader2, RefreshCw, ScrollText, Search, XCircle } from 'lucide-react';

const localTest = import.meta.env.DEV && import.meta.env.VITE_CADDYUI_LOCAL_TEST === '1';
const REFRESH_STORAGE_KEY = 'caddyui.logs.refreshMs';
const REFRESH_OPTIONS = [0, 5000, 15000, 30000];
const localEvents = [
  {
    id: 'event-local-1',
    createdAt: Date.now(),
    actorUsername: 'local',
    actorRole: 'admin',
    kind: 'proxy',
    action: 'create',
    targetType: 'proxy',
    targetId: 'new.example.com',
    status: 'success',
    message: 'Created proxy new.example.com.',
    details: { host: 'new.example.com', upstream: '127.0.0.1:8080' },
  },
  {
    id: 'event-local-2',
    createdAt: Date.now() - 1000,
    actorUsername: 'local',
    actorRole: 'admin',
    kind: 'config',
    action: 'reload',
    targetType: 'caddy',
    targetId: 'admin-api',
    status: 'error',
    message: 'Caddy reload failed.',
    details: { code: 500, stderr: 'loading config: upstream connection failed' },
  },
];
const localLogs = [
  {
    source: 'local-test',
    ok: true,
    content: [
      JSON.stringify({ level: 'info', ts: Date.now() / 1000, msg: 'Caddy started' }),
      JSON.stringify({ level: 'warn', ts: Date.now() / 1000, msg: 'Certificate renewal delayed' }),
      '2026-08-25T18:00:00Z ERROR upstream connection failed with status 502',
      'Plain diagnostic output',
    ].join('\n'),
  },
];

function readStoredRefreshMs() {
  try {
    const parsed = Number(window.localStorage.getItem(REFRESH_STORAGE_KEY) || 0);
    return REFRESH_OPTIONS.includes(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function formatEventTime(value) {
  const numeric = Number(value || 0);
  const milliseconds = numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds || value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function stringifyDetails(details = {}) {
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return '{}';
  }
}

function structuredSeverity(value = '') {
  const level = String(value || '').trim().toLowerCase();
  if (['fatal', 'panic', 'crit', 'critical', 'alert', 'emerg', 'emergency', 'error', 'err'].includes(level)) return 'error';
  if (['warn', 'warning'].includes(level)) return 'warning';
  if (['info', 'notice', 'debug', 'trace'].includes(level)) return 'info';
  return '';
}

function textSeverity(value = '') {
  const text = String(value || '');
  if (/\b(?:error|fatal|panic|failed|failure|exception|critical)\b/i.test(text) || /\b5\d{2}\b/.test(text)) return 'error';
  if (/\b(?:warn|warning|deprecated)\b/i.test(text) || /\b4\d{2}\b/.test(text)) return 'warning';
  return '';
}

function lineTimestamp(raw, parsed) {
  const candidate = parsed?.ts ?? parsed?.time ?? parsed?.timestamp;
  if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
  return String(raw || '').match(/^\s*(\d{4}-\d{2}-\d{2}[T ][^\s]+)/)?.[1] || '';
}

function parseLogLine(rawLine, source, index, sourceOk = true) {
  const raw = String(rawLine || '');
  let parsed = null;
  try {
    const candidate = JSON.parse(raw);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) parsed = candidate;
  } catch {}
  const level = structuredSeverity(parsed?.level ?? parsed?.severity ?? parsed?.lvl);
  const messageCandidate = parsed?.msg ?? parsed?.message ?? parsed?.error;
  const message = typeof messageCandidate === 'string' ? messageCandidate : raw;
  const severity = !sourceOk ? 'error' : level || textSeverity(message) || textSeverity(raw) || (parsed ? 'info' : 'unknown');
  return {
    id: `${source}:${index}`,
    source,
    sourceOk,
    raw,
    parsed,
    message: message || '(empty line)',
    timestamp: lineTimestamp(raw, parsed),
    severity,
    index,
  };
}

function parseLogSources(logs = []) {
  return logs.flatMap((entry) => {
    const content = String(entry?.content || '');
    const rawLines = content.split(/\r?\n/).filter((line, index, values) => line || values.length === 1);
    return rawLines.map((line, index) => parseLogLine(line, entry.source || 'unknown', index, entry.ok !== false));
  });
}

function eventSearchText(event = {}) {
  return [
    event.actorUsername,
    event.actorRole,
    event.kind,
    event.action,
    event.targetType,
    event.targetId,
    event.status,
    event.message,
    stringifyDetails(event.details),
  ]
    .join(' ')
    .toLowerCase();
}

function eventSeverity(event = {}) {
  const status = String(event.status || 'success').toLowerCase();
  if (status === 'error' || status === 'failed' || status === 'failure') return 'error';
  if (status === 'warning' || status === 'warn') return 'warning';
  return 'success';
}

function severityRank(value) {
  return { error: 0, warning: 1, unknown: 2, info: 3, success: 3 }[value] ?? 4;
}

function SeverityIcon({ severity }) {
  if (severity === 'error') return <XCircle size={14} />;
  if (severity === 'warning') return <AlertTriangle size={14} />;
  if (severity === 'info' || severity === 'success') return <CheckCircle2 size={14} />;
  return <CircleHelp size={14} />;
}

function MetricButton({ active, className = '', onClick, count, label }) {
  return (
    <button type="button" className={`log-metric ${className} ${active ? 'active' : ''}`} onClick={onClick}>
      <b>{count}</b>
      <span>{label}</span>
    </button>
  );
}

export default function Logs({ api, initialView = 'system', selectedEventId = '', onSelectView }) {
  const [logs, setLogs] = useState(localTest ? localLogs : []);
  const [events, setEvents] = useState(localTest ? localEvents : []);
  const [busy, setBusy] = useState(false);
  const [eventBusy, setEventBusy] = useState(false);
  const [lines, setLines] = useState(250);
  const [mode, setMode] = useState('all');
  const [view, setView] = useState(initialView || 'system');
  const [expandedEventId, setExpandedEventId] = useState(selectedEventId || '');
  const [expandedLogId, setExpandedLogId] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [logQuery, setLogQuery] = useState('');
  const [logSeverity, setLogSeverity] = useState('all');
  const [logSource, setLogSource] = useState('all');
  const [logSort, setLogSort] = useState('newest');
  const [eventStatus, setEventStatus] = useState('all');
  const [eventKind, setEventKind] = useState('all');
  const [eventSort, setEventSort] = useState('newest');
  const [rawView, setRawView] = useState(false);
  const [refreshMs, setRefreshMs] = useState(readStoredRefreshMs);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [copied, setCopied] = useState(false);

  const loadLogs = async () => {
    if (localTest || busy) return;
    setBusy(true);
    try {
      setLogs((await api(`/api/logs?lines=${lines}&mode=${mode}`)).logs || []);
      setLastUpdatedAt(Date.now());
    } finally {
      setBusy(false);
    }
  };

  const loadEvents = async () => {
    if (localTest || eventBusy) return;
    setEventBusy(true);
    try {
      setEvents((await api('/api/events?limit=250')).events || []);
      setLastUpdatedAt(Date.now());
    } finally {
      setEventBusy(false);
    }
  };

  const setActiveView = (nextView) => {
    setView(nextView);
    onSelectView?.(nextView);
  };

  const activeRefresh = () => {
    if (view === 'events') return loadEvents();
    return loadLogs();
  };

  useEffect(() => {
    if (initialView === 'events' || initialView === 'system') setView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (selectedEventId) {
      setView('events');
      setExpandedEventId(selectedEventId);
    }
  }, [selectedEventId]);

  useEffect(() => {
    if (view === 'events') loadEvents();
    else loadLogs();
  }, [view, lines, mode]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const timer = window.setInterval(() => {
      if (view === 'events') loadEvents();
      else loadLogs();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, view, lines, mode, busy, eventBusy]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REFRESH_STORAGE_KEY, String(refreshMs));
    } catch {}
  }, [refreshMs]);

  const parsedLogs = useMemo(() => parseLogSources(logs), [logs]);
  const logSources = useMemo(() => [...new Set(parsedLogs.map((entry) => entry.source))].sort(), [parsedLogs]);
  const logCounts = useMemo(() => parsedLogs.reduce((counts, entry) => {
    counts.total += 1;
    counts[entry.severity] = (counts[entry.severity] || 0) + 1;
    return counts;
  }, { total: 0, error: 0, warning: 0, info: 0, unknown: 0 }), [parsedLogs]);
  const filteredLogs = useMemo(() => {
    const query = logQuery.trim().toLowerCase();
    const filtered = parsedLogs.filter((entry) => {
      if (logSeverity !== 'all' && entry.severity !== logSeverity) return false;
      if (logSource !== 'all' && entry.source !== logSource) return false;
      if (query && !`${entry.source} ${entry.message} ${entry.raw}`.toLowerCase().includes(query)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (logSort === 'source') return a.source.localeCompare(b.source) || a.index - b.index;
      return logSort === 'oldest' ? a.index - b.index : b.index - a.index;
    });
  }, [parsedLogs, logQuery, logSeverity, logSource, logSort]);

  const eventKinds = useMemo(() => [...new Set(events.map((event) => event.kind).filter(Boolean))].sort(), [events]);
  const eventCounts = useMemo(() => events.reduce((counts, event) => {
    const severity = eventSeverity(event);
    counts.total += 1;
    counts[severity] += 1;
    return counts;
  }, { total: 0, error: 0, warning: 0, success: 0 }), [events]);
  const filteredEvents = useMemo(() => {
    const query = eventQuery.trim().toLowerCase();
    const filtered = events.filter((event) => {
      if (eventStatus !== 'all' && eventSeverity(event) !== eventStatus) return false;
      if (eventKind !== 'all' && event.kind !== eventKind) return false;
      return !query || eventSearchText(event).includes(query);
    });
    return [...filtered].sort((a, b) => {
      if (eventSort === 'oldest') return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      if (eventSort === 'severity') return severityRank(eventSeverity(a)) - severityRank(eventSeverity(b)) || Number(b.createdAt || 0) - Number(a.createdAt || 0);
      if (eventSort === 'actor') return String(a.actorUsername || '').localeCompare(String(b.actorUsername || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0);
      if (eventSort === 'action') return String(a.action || '').localeCompare(String(b.action || '')) || Number(b.createdAt || 0) - Number(a.createdAt || 0);
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
  }, [events, eventQuery, eventStatus, eventKind, eventSort]);

  useEffect(() => {
    if (!filteredEvents.length) {
      setExpandedEventId('');
      return;
    }
    if (selectedEventId && filteredEvents.some((event) => event.id === selectedEventId)) {
      setExpandedEventId(selectedEventId);
      return;
    }
    if (!expandedEventId || !filteredEvents.some((event) => event.id === expandedEventId)) {
      setExpandedEventId(filteredEvents[0].id);
    }
  }, [filteredEvents, expandedEventId, selectedEventId]);

  const selectedEvent = useMemo(
    () => filteredEvents.find((event) => event.id === expandedEventId) || null,
    [filteredEvents, expandedEventId]
  );
  const failureCode = selectedEvent?.details?.code;
  const hasFailureCode = failureCode !== undefined && failureCode !== null && failureCode !== '' && Number(failureCode) !== 0;
  const failureDetails = selectedEvent?.details?.stderr || selectedEvent?.details?.error || (hasFailureCode ? `Exit code: ${failureCode}` : '');

  const copyEventDetails = async () => {
    if (!selectedEvent) return;
    const text = stringifyDetails({ ...selectedEvent, details: selectedEvent.details });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const updatedLabel = lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString()}` : 'Not refreshed yet';

  return (
    <section>
      <div className="section-head logs-section-head">
        <div>
          <h2>Logs</h2>
          <p>Find failures quickly across Caddy output and CaddyUI activity.</p>
        </div>
        <div className="logs-refresh-controls">
          <label>
            Auto refresh
            <select value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))}>
              <option value={0}>Off</option>
              <option value={5000}>5 seconds</option>
              <option value={15000}>15 seconds</option>
              <option value={30000}>30 seconds</option>
            </select>
          </label>
          <button type="button" onClick={activeRefresh} disabled={busy || eventBusy}>
            {(busy || eventBusy) ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Refresh
          </button>
          <small>{updatedLabel}</small>
        </div>
      </div>

      <div className="page-tabs logs-tabs">
        <button type="button" className={view === 'system' ? 'active-tab' : ''} onClick={() => setActiveView('system')}>
          <ScrollText size={16} /> System logs
        </button>
        <button type="button" className={view === 'events' ? 'active-tab' : ''} onClick={() => setActiveView('events')}>
          <History size={16} /> Event log
        </button>
      </div>

      {view === 'system' && (
        <div className="log-diagnostics">
          <div className="log-metrics" aria-label="System log severity counts">
            <MetricButton active={logSeverity === 'all'} onClick={() => setLogSeverity('all')} count={logCounts.total} label="All" />
            <MetricButton className="error" active={logSeverity === 'error'} onClick={() => setLogSeverity('error')} count={logCounts.error} label="Errors" />
            <MetricButton className="warning" active={logSeverity === 'warning'} onClick={() => setLogSeverity('warning')} count={logCounts.warning} label="Warnings" />
            <MetricButton className="info" active={logSeverity === 'info'} onClick={() => setLogSeverity('info')} count={logCounts.info} label="Info" />
            <MetricButton active={logSeverity === 'unknown'} onClick={() => setLogSeverity('unknown')} count={logCounts.unknown} label="Other" />
          </div>

          <div className="logs-filterbar">
            <label className="logs-search-field"><Search size={16} /><input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Search messages or sources" aria-label="Search system logs" /></label>
            <select value={logSource} onChange={(event) => setLogSource(event.target.value)} aria-label="Filter log source">
              <option value="all">All sources</option>
              {logSources.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <select value={logSort} onChange={(event) => setLogSort(event.target.value)} aria-label="Sort system logs">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="source">Source</option>
            </select>
            <select value={lines} onChange={(event) => setLines(Number(event.target.value))} aria-label="System log line count">
              <option value={100}>100 lines</option>
              <option value={250}>250 lines</option>
              <option value={500}>500 lines</option>
              <option value={1000}>1000 lines</option>
            </select>
            <select value={mode} onChange={(event) => setMode(event.target.value)} aria-label="System log source mode">
              <option value="all">Files + journal</option>
              <option value="files">Files only</option>
              <option value="journal">Journal only</option>
            </select>
            <button type="button" className={rawView ? 'active-filter' : ''} onClick={() => setRawView((current) => !current)}>Raw</button>
          </div>

          {busy && parsedLogs.length === 0 && <div className="proxy-loading"><div className="proxy-row-skeleton"><span /><span /><span /><span /><span /></div><div className="proxy-row-skeleton"><span /><span /><span /><span /><span /></div></div>}
          {!busy && parsedLogs.length === 0 && <div className="event-empty-state">No log lines were returned. Configure log paths in Settings or check the Caddy service.</div>}
          {parsedLogs.length > 0 && filteredLogs.length === 0 && <div className="event-empty-state">No loaded log entries match the current filters.</div>}

          {rawView ? (
            logs.map((entry) => <article className={`log-card ${entry.ok === false ? 'log-source-error' : ''}`} key={entry.source}><h3>{entry.source}</h3><pre>{entry.content}</pre></article>)
          ) : (
            <div className="diagnostic-log-list">
              {filteredLogs.map((entry) => {
                const expanded = expandedLogId === entry.id;
                return (
                  <article key={entry.id} className={`diagnostic-log-row ${entry.severity} ${expanded ? 'expanded' : ''}`}>
                    <button type="button" className="diagnostic-log-summary" onClick={() => setExpandedLogId(expanded ? '' : entry.id)} aria-expanded={expanded}>
                      <span className={`event-status ${entry.severity}`}><SeverityIcon severity={entry.severity} />{entry.severity}</span>
                      <time>{entry.timestamp ? formatEventTime(entry.timestamp) : 'No timestamp'}</time>
                      <small title={entry.source}>{entry.source}</small>
                      <strong>{entry.message}</strong>
                    </button>
                    {expanded && (
                      <div className="diagnostic-log-details">
                        {entry.parsed && <pre>{JSON.stringify(entry.parsed, null, 2)}</pre>}
                        <div><b>Raw line</b><pre>{entry.raw}</pre></div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === 'events' && (
        <>
          <div className="log-metrics" aria-label="Activity event status counts">
            <MetricButton active={eventStatus === 'all'} onClick={() => setEventStatus('all')} count={eventCounts.total} label="All" />
            <MetricButton className="error" active={eventStatus === 'error'} onClick={() => setEventStatus('error')} count={eventCounts.error} label="Errors" />
            <MetricButton className="warning" active={eventStatus === 'warning'} onClick={() => setEventStatus('warning')} count={eventCounts.warning} label="Warnings" />
            <MetricButton className="info" active={eventStatus === 'success'} onClick={() => setEventStatus('success')} count={eventCounts.success} label="Success" />
          </div>
          <div className="event-log-layout">
            <article className="event-table-card">
              <div className="event-table-head">
                <div>
                  <h3>Activity history</h3>
                  <p>{filteredEvents.length} of {events.length} events shown.</p>
                </div>
                <div className="event-log-tools">
                  <label className="event-log-search"><Search size={16} /><input value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Search events or details" /></label>
                  <select value={eventKind} onChange={(event) => setEventKind(event.target.value)} aria-label="Filter event kind"><option value="all">All kinds</option>{eventKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
                  <select value={eventSort} onChange={(event) => setEventSort(event.target.value)} aria-label="Sort activity events">
                    <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="severity">Severity</option><option value="actor">Actor</option><option value="action">Action</option>
                  </select>
                </div>
              </div>
              <div className="event-table-wrap">
                {filteredEvents.length > 0 ? (
                  <table className="event-table">
                    <thead><tr><th className="event-col-time">Time</th><th className="event-col-user">Actor</th><th className="event-col-action">Action</th><th className="event-col-target">Target</th><th className="event-col-status">Status</th><th className="event-col-message">Message</th></tr></thead>
                    <tbody>{filteredEvents.map((event) => (
                      <tr key={event.id} className={expandedEventId === event.id ? 'selected' : ''} onClick={() => setExpandedEventId(event.id)} tabIndex={0} onKeyDown={(keyEvent) => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') setExpandedEventId(event.id); }}>
                        <td><time>{formatEventTime(event.createdAt)}</time></td>
                        <td><div className="event-actor-cell"><strong>{event.actorUsername || 'system'}</strong><small>{event.actorRole || 'system'}</small></div></td>
                        <td><div className="event-action-cell"><span className="event-kind">{event.kind}</span><strong>{event.action}</strong></div></td>
                        <td><div className="event-target-cell"><strong>{event.targetId || event.targetType || 'n/a'}</strong><small>{event.targetType || 'event'}</small></div></td>
                        <td><span className={`event-status ${eventSeverity(event)}`}><SeverityIcon severity={eventSeverity(event)} />{event.status || 'success'}</span></td>
                        <td className="event-message-cell">{event.message || 'No message'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <div className="event-empty-state event-empty-table">{events.length ? 'No events match the current filters.' : 'No events recorded yet.'}</div>}
              </div>
            </article>

            <aside className="event-detail-card">
              {selectedEvent ? (
                <div className="event-detail-body">
                  <div className="event-table-head"><div><span className={`event-status ${eventSeverity(selectedEvent)}`}>{selectedEvent.status || 'success'}</span><h3>Event details</h3><p className="event-detail-id">{selectedEvent.id}</p></div><button type="button" onClick={copyEventDetails}><Copy size={15} />{copied ? 'Copied' : 'Copy details'}</button></div>
                  <div className="event-detail-grid"><div><span>Time</span><b>{formatEventTime(selectedEvent.createdAt)}</b></div><div><span>Actor</span><b>{selectedEvent.actorUsername || 'system'} · {selectedEvent.actorRole || 'system'}</b></div><div><span>Kind</span><b>{selectedEvent.kind || 'event'}</b></div><div><span>Action</span><b>{selectedEvent.action || 'action'}</b></div><div><span>Target type</span><b>{selectedEvent.targetType || 'n/a'}</b></div><div><span>Target id</span><b>{selectedEvent.targetId || 'n/a'}</b></div></div>
                  {failureDetails && <div className="event-message-panel failure-details"><h4><AlertTriangle size={16} /> Failure details</h4><pre>{failureDetails}</pre></div>}
                  <div className="event-message-panel"><h4>Message</h4><p>{selectedEvent.message || 'No message'}</p></div>
                  <div className="event-message-panel"><h4>Details</h4><pre>{stringifyDetails(selectedEvent.details)}</pre></div>
                </div>
              ) : <div className="event-empty-state">Choose an event to inspect its details.</div>}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
