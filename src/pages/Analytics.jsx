import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, Clock3, RefreshCw, Server, TriangleAlert } from 'lucide-react';

const ranges = [
  ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'],
];

const formatNumber = new Intl.NumberFormat();
const formatBytes = (value = 0) => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
};
const formatDuration = (seconds = 0) => seconds >= 1 ? `${seconds.toFixed(2)} s` : `${Math.round(seconds * 1000)} ms`;

function LineChart({ buckets, range }) {
  const values = buckets.map((bucket) => bucket.requests);
  const maximum = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = 88 - (value / maximum) * 70;
    return `${x},${y}`;
  }).join(' ');
  const labels = range === '7d'
    ? buckets.map((bucket) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(bucket.start)))
    : buckets.map((bucket) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(bucket.start)));

  return (
    <div className="traffic-chart-wrap">
      <div className="traffic-chart-scale" aria-hidden="true"><span>{formatNumber.format(maximum)}</span><span>{formatNumber.format(Math.round(maximum / 2))}</span><span>0</span></div>
      <svg className="traffic-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Traffic requests over the ${range === '7d' ? 'last seven days' : 'last twenty-four hours'}`}>
        <defs>
          <linearGradient id="traffic-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
        </defs>
        <line x1="0" y1="18" x2="100" y2="18" /><line x1="0" y1="53" x2="100" y2="53" /><line x1="0" y1="88" x2="100" y2="88" />
        <polygon points={`0,88 ${points} 100,88`} fill="url(#traffic-area)" />
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="traffic-chart-labels" aria-hidden="true"><span>{labels[0]}</span><span>{labels[Math.floor(labels.length / 2)]}</span><span>{labels.at(-1)}</span></div>
    </div>
  );
}

export default function Analytics({ api }) {
  const [range, setRange] = useState('24h');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setBusy(true); setError('');
    try { setData(await api(`/api/analytics?range=${range}`)); } catch (err) { setError(err.message || 'Unable to load traffic analytics.'); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [range]);

  const totalResponses = useMemo(() => (data?.statusCodes || []).reduce((total, item) => total + item.count, 0), [data]);
  const errorRate = data?.requests ? ((data.errors / data.requests) * 100).toFixed(1) : '0.0';
  return <section className="analytics-page">
    <div className="section-head analytics-head">
      <div><h2>Traffic analytics</h2><p>Request activity from configured Caddy logs and the system journal.</p></div>
      <div className="analytics-actions" role="group" aria-label="Analytics time range">
        {ranges.map(([value, label]) => <button key={value} type="button" className={range === value ? 'active' : ''} onClick={() => setRange(value)} aria-pressed={range === value}>{label}</button>)}
        <button type="button" className="icon-button" onClick={load} disabled={busy} aria-label="Refresh analytics" title="Refresh analytics"><RefreshCw size={17} className={busy ? 'spin' : ''} /></button>
      </div>
    </div>
    {error && <div className="notice error"><TriangleAlert size={18} /><span>{error}</span></div>}
    <div className="analytics-kpis" aria-busy={busy}>
      <article><span className="analytics-icon"><Activity size={18} /></span><div><span>Total requests</span><strong>{formatNumber.format(data?.requests || 0)}</strong><small>{data?.requests ? `${data.uniqueVisitors} unique visitors` : 'No request records in this period'}</small></div></article>
      <article><span className="analytics-icon"><TriangleAlert size={18} /></span><div><span>Error rate</span><strong>{errorRate}%</strong><small>{formatNumber.format(data?.errors || 0)} responses with 4xx or 5xx</small></div></article>
      <article><span className="analytics-icon"><Clock3 size={18} /></span><div><span>Avg. response time</span><strong>{formatDuration(data?.averageDuration || 0)}</strong><small>Recorded request duration</small></div></article>
      <article><span className="analytics-icon"><ArrowDownToLine size={18} /></span><div><span>Data transferred</span><strong>{formatBytes(data?.bytes || 0)}</strong><small>Response body size</small></div></article>
    </div>
    <div className="analytics-grid">
      <article className="analytics-panel traffic-panel">
        <div className="analytics-panel-head"><div><h3>Requests over time</h3><p>{data?.requests ? `${formatNumber.format(data.requests)} requests in the selected period` : 'No requests recorded in this period'}</p></div><span className="chart-legend"><i /> Requests</span></div>
        <LineChart buckets={data?.buckets || []} range={range} />
      </article>
      <article className="analytics-panel status-panel">
        <div className="analytics-panel-head"><div><h3>Response codes</h3><p>Distribution of recorded responses</p></div></div>
        <div className="status-breakdown">
          {(data?.statusCodes || []).map((item) => <div key={item.code}><div><span className={`status-code status-${Math.floor(item.code / 100)}xx`}>{item.code}</span><span>{formatNumber.format(item.count)} requests</span></div><div className="status-bar"><span style={{ width: `${totalResponses ? (item.count / totalResponses) * 100 : 0}%` }} /></div></div>)}
          {!data?.statusCodes?.length && <p className="analytics-empty">No response-code records were found in the selected period.</p>}
        </div>
      </article>
      <article className="analytics-panel hosts-panel">
        <div className="analytics-panel-head"><div><h3>Top hosts</h3><p>Most requested domains and routes</p></div><Server size={18} /></div>
        <ol className="host-list">
          {(data?.hosts || []).map((host, index) => <li key={host.name}><span className="host-rank">{index + 1}</span><div><strong>{host.name}</strong><small>{formatNumber.format(host.requests)} requests · {formatBytes(host.bytes)}</small></div><span className="host-share">{data?.requests ? Math.round((host.requests / data.requests) * 100) : 0}%</span></li>)}
          {!data?.hosts?.length && <li className="analytics-empty">No host records were found in the selected period.</li>}
        </ol>
      </article>
    </div>
    {data?.unparsedLines > 0 && <p className="analytics-note">{formatNumber.format(data.unparsedLines)} log lines could not be read as Caddy JSON access logs and are excluded.</p>}
  </section>;
}
