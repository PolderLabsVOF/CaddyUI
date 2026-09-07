import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Notice } from '../components/common.jsx';

function expiryLabel(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'unknown';
  const days = Math.ceil((timestamp - Date.now()) / 86400000);
  return days < 0 ? `expired ${Math.abs(days)}d ago` : `${days}d remaining`;
}

export default function Tls({ api, canAdmin, setConfig, onConfigChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ email: '', acmeCa: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await api('/api/ssl/status');
      setData(result);
      setForm({ email: result.global?.email || '', acmeCa: result.global?.acmeCa || '' });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await api('/api/ssl/settings', { method: 'POST', body: JSON.stringify(form) });
      setConfig?.((current) => ({ ...current, content: result.content, parsed: result.parsed }));
      setForm(result.global);
      onConfigChanged?.('TLS settings saved.');
      await refresh();
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>TLS & certificates</h2>
          <p>Live TLS handshakes for every configured hostname, plus the global ACME settings Caddy persists through its API.</p>
        </div>
        <button onClick={refresh} disabled={busy}><RefreshCw size={16} /> Refresh checks</button>
      </div>

      {message && <Notice type="error">{message}</Notice>}

      <div className="tls-summary">
        <div><span>Hosts checked</span><b>{data?.certificates?.length ?? '—'}</b></div>
        <div><span>Successful TLS handshakes</span><b>{data ? data.certificates.filter((item) => item.ok).length : '—'}</b></div>
        <div><span>Last checked</span><b>{data?.checkedAt ? new Date(data.checkedAt).toLocaleString() : '—'}</b></div>
      </div>

      <div className="tls-grid">
        <section className="tls-card tls-card-wide">
          <h3>Certificate status</h3>
          {!data && <p>{busy ? 'Checking TLS endpoints…' : 'No certificate data yet.'}</p>}
          {data?.certificates?.map((item) => (
            <article className={`tls-certificate ${item.ok ? 'ok' : 'error'}`} key={item.host}>
              <div>
                <strong>{item.host}</strong>
                <span className="tls-state">{item.ok ? (item.authorized ? 'trusted' : 'handshake succeeded; chain not trusted') : 'handshake failed'}</span>
              </div>
              {item.ok ? (
                <dl>
                  <div><dt>Subject</dt><dd>{item.certificate?.subject?.CN || '—'}</dd></div>
                  <div><dt>Issuer</dt><dd>{item.certificate?.issuer?.O || item.certificate?.issuer?.CN || '—'}</dd></div>
                  <div><dt>Expires</dt><dd>{item.certificate?.validTo || '—'} · {expiryLabel(item.certificate?.validTo)}</dd></div>
                  <div><dt>SANs</dt><dd>{item.certificate?.subjectAltName || '—'}</dd></div>
                </dl>
              ) : <p>{item.error}</p>}
            </article>
          ))}
        </section>

        <form className="tls-card" onSubmit={save}>
          <h3>Global ACME settings</h3>
          <p>These write the Caddy global options and are applied through the Admin API. Leave the CA blank to use Caddy’s default public issuer.</p>
          <label>
            ACME account email
            <input type="email" value={form.email} disabled={!canAdmin || busy} placeholder="admin@example.com" onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            ACME directory URL
            <input type="url" value={form.acmeCa} disabled={!canAdmin || busy} placeholder="https://acme-v02.api.letsencrypt.org/directory" onChange={(event) => setForm({ ...form, acmeCa: event.target.value })} />
          </label>
          {canAdmin ? <button className="primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : null}Save TLS settings</button> : <p className="settings-helper">An administrator can change global ACME settings.</p>}
        </form>

        <section className="tls-card">
          <h3>Automation policy</h3>
          <p>{data?.automation ? 'Caddy reports an active TLS automation policy.' : 'No explicit automation policy is loaded; Caddy automatic HTTPS defaults apply.'}</p>
          <p className="settings-helper">For a custom certificate or `tls internal`, edit the relevant proxy’s raw block in Configuration. The live certificate check above will show the outcome immediately.</p>
        </section>
      </div>
    </section>
  );
}
