import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Notice } from '../components/common.jsx';

function daysRemaining(value) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

function expiryLabel(value) {
  const days = daysRemaining(value);
  if (days === null || Number.isNaN(days)) return 'Expiry unavailable';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `${days} days remaining`;
}

function certificateState(item) {
  if (!item.ok) return 'failed';
  if (!item.authorized) return 'untrusted';
  const days = daysRemaining(item.certificate?.validTo);
  if (days !== null && days <= 14) return 'expiring';
  return 'healthy';
}

const stateLabels = {
  healthy: 'Healthy',
  expiring: 'Expiring soon',
  untrusted: 'Not authorized',
  failed: 'Check failed',
};

export default function Tls({ api, canAdmin, setConfig, onConfigChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ email: '', acmeCa: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selectedHost, setSelectedHost] = useState('');

  const refresh = async ({ preserveMessage = false } = {}) => {
    setBusy(true);
    if (!preserveMessage) setMessage(null);
    try {
      const result = await api('/api/ssl/status');
      setData(result);
      setForm({ email: result.global?.email || '', acmeCa: result.global?.acmeCa || '' });
      setSelectedHost((current) => current || result.certificates?.[0]?.host || '');
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const certificates = data?.certificates || [];
  const counts = useMemo(() => certificates.reduce((result, certificate) => {
    result[certificateState(certificate)] += 1;
    return result;
  }, { healthy: 0, expiring: 0, untrusted: 0, failed: 0 }), [certificates]);
  const visibleCertificates = filter === 'all'
    ? certificates
    : certificates.filter((certificate) => certificateState(certificate) === filter);
  const selected = certificates.find((certificate) => certificate.host === selectedHost)
    || visibleCertificates[0]
    || null;
  const authorities = useMemo(() => {
    const grouped = new Map();
    for (const certificate of certificates) {
      const issuer = certificate.certificate?.issuer?.O
        || certificate.certificate?.issuer?.CN
        || 'Unknown certificate authority';
      const current = grouped.get(issuer) || { issuer, total: 0, healthy: 0, failed: 0 };
      current.total += 1;
      if (certificate.ok && certificate.authorized) current.healthy += 1;
      if (!certificate.ok) current.failed += 1;
      grouped.set(issuer, current);
    }
    return [...grouped.values()].sort((a, b) => b.total - a.total || a.issuer.localeCompare(b.issuer));
  }, [certificates]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await api('/api/ssl/settings', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setConfig?.((current) => ({ ...current, content: result.content, parsed: result.parsed }));
      onConfigChanged?.('TLS automation settings saved.');
      setMessage({ type: 'success', text: 'TLS automation settings saved.' });
      await refresh({ preserveMessage: true });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  return <section className="tls-page">
    <div className="section-head tls-header">
      <div>
        <p className="eyebrow">Security posture</p>
        <h1>TLS control room</h1>
        <p>Monitor every configured hostname and set the defaults Caddy uses for ACME certificate automation.</p>
      </div>
      <button onClick={refresh} disabled={busy}>
        <RefreshCw size={16} className={busy ? 'spin' : ''} /> Refresh checks
      </button>
    </div>

    {message && <Notice type={message.type}>{message.text}</Notice>}

    <div className="tls-kpis">
      <div><span>Configured hosts</span><strong>{certificates.length}</strong><small>Certificates discovered from live Caddy config</small></div>
      <div className="good"><span>Healthy</span><strong>{counts.healthy}</strong><small>Authorized with a valid certificate</small></div>
      <div className="attention"><span>Needs attention</span><strong>{counts.expiring + counts.untrusted}</strong><small>Expiring within 14 days or not authorized</small></div>
      <div className={counts.failed ? 'danger' : ''}><span>Failed checks</span><strong>{counts.failed}</strong><small>Could not complete a TLS handshake</small></div>
    </div>

    <div className="tls-layout">
      <section className="tls-panel tls-inventory">
        <div className="tls-panel-head">
          <div>
            <h2>Certificate inventory</h2>
            <p>Live HTTPS checks run from CaddyUI’s server.</p>
          </div>
          {data?.checkedAt && <time dateTime={data.checkedAt}><Clock3 size={14} /> Checked {new Date(data.checkedAt).toLocaleString()}</time>}
        </div>

        <div className="tls-filters" aria-label="Filter certificate status">
          {[
            ['all', `All ${certificates.length}`],
            ['healthy', `Healthy ${counts.healthy}`],
            ['expiring', `Expiring ${counts.expiring}`],
            ['untrusted', `Unauthorized ${counts.untrusted}`],
            ['failed', `Failed ${counts.failed}`],
          ].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
        </div>

        {!data && !busy && <p className="empty-state">Certificate status has not been loaded yet.</p>}
        {busy && !data && <p className="empty-state"><Loader2 size={18} className="spin" /> Loading certificate status…</p>}
        {data && visibleCertificates.length === 0 && <p className="empty-state">No certificates match this filter.</p>}
        <div className="tls-host-list">
          {visibleCertificates.map((certificate) => {
            const state = certificateState(certificate);
            return <button key={certificate.host} className={`tls-host-row ${state} ${selected?.host === certificate.host ? 'selected' : ''}`} onClick={() => setSelectedHost(certificate.host)}>
              <span className="tls-status-dot" aria-hidden="true" />
              <span className="tls-host-name"><strong>{certificate.host}</strong><small>{certificate.certificate?.issuer?.O || certificate.certificate?.issuer?.CN || certificate.error || stateLabels[state]}</small></span>
              <span className="tls-host-expiry">{certificate.ok ? expiryLabel(certificate.certificate?.validTo) : 'Unavailable'}</span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>;
          })}
        </div>
      </section>

      <aside className="tls-side">
        <section className="tls-panel tls-automation">
          <div className="tls-panel-head"><div><h2>Caddy automatic HTTPS</h2><p>Live TLS automation state from Caddy’s Admin API.</p></div><ShieldCheck size={20} /></div>
          {!data?.automation && <p className="tls-help">Caddy did not return a TLS automation app. Automatic certificate management may be disabled or the Admin API is unavailable.</p>}
          {data?.automation && <>
            <div className="tls-automation-state"><span className="tls-status-dot" /><strong>Automation app active</strong></div>
            <dl className="tls-details-list">
              <div><dt>Policies</dt><dd>{Array.isArray(data.automation.policies) ? data.automation.policies.length : 0}</dd></div>
              <div><dt>Storage</dt><dd className="mono">{formatTlsValue(data.automation.storage || data.automation.storage_clean_interval || 'Caddy default')}</dd></div>
              <div><dt>On-demand TLS</dt><dd>{data.automation.on_demand ? 'Enabled' : 'Not configured'}</dd></div>
            </dl>
            {Array.isArray(data.automation.policies) && data.automation.policies.length > 0 && <div className="tls-policy-list">
              {data.automation.policies.map((policy, index) => <div className="tls-policy" key={`${policy.name || 'policy'}-${index}`}>
                <strong>{policy.name || `Policy ${index + 1}`}</strong>
                <span>{Array.isArray(policy.subjects) && policy.subjects.length ? policy.subjects.join(', ') : 'All eligible hostnames'}</span>
                <small>{formatIssuers(policy.issuers)}</small>
              </div>)}
            </div>}
          </>}
        </section>

        <section className="tls-panel tls-authorities">
          <div className="tls-panel-head"><div><h2>Certificate authorities</h2><p>Issuers observed in the live certificate checks.</p></div></div>
          {authorities.length === 0 && <p className="empty-state">No certificate authority data is available yet.</p>}
          {authorities.map((authority) => <div className="tls-authority-row" key={authority.issuer}>
            <span className={`tls-status-dot ${authority.failed ? 'failed' : ''}`} />
            <span><strong>{authority.issuer}</strong><small>{authority.healthy}/{authority.total} certificates healthy</small></span>
          </div>)}
        </section>

        <section className="tls-panel tls-detail">
          <div className="tls-panel-head"><div><h2>Certificate details</h2><p>{selected?.host || 'Choose a hostname'}</p></div></div>
          {selected ? <CertificateDetails certificate={selected} /> : <p className="empty-state">Select a hostname to inspect its certificate.</p>}
        </section>

        <section className="tls-panel tls-settings">
          <div className="tls-panel-head"><div><h2>ACME defaults</h2><p>Applied to Caddy’s global TLS automation.</p></div><ShieldCheck size={20} /></div>
          {!canAdmin && <p className="tls-help">Administrator access is required to change TLS automation settings.</p>}
          <form onSubmit={save}>
            <label>Account email<input type="email" value={form.email} disabled={!canAdmin || busy} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="ops@example.com" /></label>
            <label>ACME directory URL<input value={form.acmeCa} disabled={!canAdmin || busy} onChange={(event) => setForm({ ...form, acmeCa: event.target.value })} placeholder="https://acme-v02.api.letsencrypt.org/directory" /></label>
            <p className="tls-help">Leave the directory URL blank to use Caddy’s public CA default. Use a staging directory first when testing a new DNS or proxy setup.</p>
            <button className="primary" disabled={!canAdmin || busy}>{busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />} Save automation defaults</button>
          </form>
        </section>
      </aside>
    </div>
  </section>;
}

function formatTlsValue(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return 'Not configured';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function formatIssuers(issuers) {
  if (!Array.isArray(issuers) || issuers.length === 0) return 'Caddy default certificate issuers';
  return issuers.map((issuer) => typeof issuer === 'string' ? issuer : issuer?.module || issuer?.name || 'Custom issuer').join(', ');
}

function CertificateDetails({ certificate }) {
  const state = certificateState(certificate);
  const details = certificate.certificate;
  if (!certificate.ok) return <div className="tls-detail-error"><AlertTriangle size={20} /><strong>TLS check failed</strong><p>{certificate.error || 'CaddyUI could not establish a TLS connection to this hostname.'}</p></div>;
  return <>
    <div className={`tls-badge ${state}`}>{state === 'healthy' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{stateLabels[state]}</div>
    {!certificate.authorized && <div className="tls-detail-error compact"><AlertTriangle size={18} /><p>{certificate.authorizationError || 'This hostname is not currently covered by Caddy TLS automation.'}</p></div>}
    <dl className="tls-details-list">
      <div><dt>Subject</dt><dd>{details?.subject?.CN || 'Unavailable'}</dd></div>
      <div><dt>Issuer</dt><dd>{details?.issuer?.O || details?.issuer?.CN || 'Unavailable'}</dd></div>
      <div><dt>Valid from</dt><dd>{details?.validFrom ? new Date(details.validFrom).toLocaleString() : 'Unavailable'}</dd></div>
      <div><dt>Valid until</dt><dd>{details?.validTo ? `${new Date(details.validTo).toLocaleString()} (${expiryLabel(details.validTo)})` : 'Unavailable'}</dd></div>
      <div><dt>Fingerprint</dt><dd className="mono">{details?.fingerprint256 || 'Unavailable'}</dd></div>
      {details?.subjectAltName && <div><dt>Subject alternative names</dt><dd className="mono">{details.subjectAltName}</dd></div>}
    </dl>
  </>;
}
