import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Save, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { Notice, TypedConfirmModal } from '../components/common.jsx';

const localTest = import.meta.env.DEV && import.meta.env.VITE_CADDYUI_LOCAL_TEST === '1';
const sectionItems = [
  ['connection', 'Connection'],
  ['ai', 'AI assistant'],
  ['security', 'Security'],
  ['appearance', 'Appearance'],
  ['account', 'Account'],
  ['users', 'Users'],
  ['updates', 'Updates'],
  ['danger', 'Danger'],
];

const accentOptions = [
  ['violet', 'Violet', '#8b5cf6'],
  ['cyan', 'Cyan', '#06b6d4'],
  ['emerald', 'Emerald', '#10b981'],
  ['amber', 'Amber', '#f59e0b'],
  ['rose', 'Rose', '#f43f5e'],
];

function scopeText(values = []) {
  return Array.isArray(values) ? values.join('\n') : '';
}

function parseScopeText(value = '') {
  return [...new Set(String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

export default function SettingsPage({ settings, setSettings, canEdit, canAdmin, api, notify, refreshConfig, setStatus, theme, setTheme, accent, setAccent }) {
  const [activeSection, setActiveSection] = useState('connection');
  const [form, setForm] = useState({
    configMode: settings.configMode || 'api',
    caddyfilePath: settings.caddyfilePath || '',
    caddyApiUrl: settings.caddyApiUrl || 'http://127.0.0.1:2019',
    caddyApiToken: '',
    aiEnabled: Boolean(settings.aiEnabled),
    aiProvider: settings.aiProvider || 'openai',
    aiBaseUrl: settings.aiBaseUrl || '',
    aiModel: settings.aiModel || '',
    aiApiKey: '',
    aiAllowPrivateBaseUrl: Boolean(settings.aiAllowPrivateBaseUrl),
    logPaths: (settings.logPaths || []).join('\n'),
    trustProxyHops: String(settings.trustProxyHops ?? 0),
    allowRemoteSetup: Boolean(settings.allowRemoteSetup),
    secureCookieMode: settings.secureCookieMode || 'auto',
    allowedOrigins: (settings.allowedOrigins || []).join('\n'),
  });
  const [clearCaddyApiSecret, setClearCaddyApiSecret] = useState(false);
  const [clearAiApiKey, setClearAiApiKey] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [updateChannel, setUpdateChannel] = useState(settings.updateChannel || 'stable');
  const [msg, setMsg] = useState('');
  const [users, setUsers] = useState([]);
  const [discovered, setDiscovered] = useState({ caddyfiles: [], logfiles: [] });
  const [scanning, setScanning] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'view', allowedDomains: '', allowedCategories: '' });
  const [userAccessDrafts, setUserAccessDrafts] = useState({});
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [userListOpen, setUserListOpen] = useState(true);
  const [expandedUsers, setExpandedUsers] = useState({});
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [dangerModal, setDangerModal] = useState({ open: false, kind: '', value: '' });
  const [dangerBusy, setDangerBusy] = useState(false);
  const configuredLogCount = form.logPaths
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean).length;

  useEffect(() => {
    setForm({
      configMode: settings.configMode || 'api',
      caddyfilePath: settings.caddyfilePath || '',
      caddyApiUrl: settings.caddyApiUrl || 'http://127.0.0.1:2019',
      caddyApiToken: '',
      aiEnabled: Boolean(settings.aiEnabled),
      aiProvider: settings.aiProvider || 'openai',
      aiBaseUrl: settings.aiBaseUrl || '',
      aiModel: settings.aiModel || '',
      aiApiKey: '',
      aiAllowPrivateBaseUrl: Boolean(settings.aiAllowPrivateBaseUrl),
      logPaths: (settings.logPaths || []).join('\n'),
      trustProxyHops: String(settings.trustProxyHops ?? 0),
      allowRemoteSetup: Boolean(settings.allowRemoteSetup),
      secureCookieMode: settings.secureCookieMode || 'auto',
      allowedOrigins: (settings.allowedOrigins || []).join('\n'),
    });
    setClearCaddyApiSecret(false);
    setClearAiApiKey(false);
  }, [settings.configMode, settings.caddyfilePath, settings.caddyApiUrl, settings.aiEnabled, settings.aiProvider, settings.aiBaseUrl, settings.aiModel, settings.aiAllowPrivateBaseUrl, settings.logPaths, settings.trustProxyHops, settings.allowRemoteSetup, settings.secureCookieMode, settings.allowedOrigins]);

  useEffect(() => {
    setUpdateChannel(settings.updateChannel || 'stable');
  }, [settings.updateChannel]);

  useEffect(() => {
    if (!canAdmin || localTest) return;
    api('/api/users')
      .then((res) => setUsers(res.users))
      .catch(() => {});
  }, [canAdmin]);

  useEffect(() => {
    const nextDrafts = {};
    users.forEach((user) => {
      nextDrafts[user.username] = {
        allowedDomains: scopeText(user.allowedDomains || []),
        allowedCategories: scopeText(user.allowedCategories || []),
      };
    });
    setUserAccessDrafts(nextDrafts);
  }, [users]);

  useEffect(() => {
    setExpandedUsers((current) => {
      const next = {};
      users.forEach((user) => {
        if (Object.prototype.hasOwnProperty.call(current, user.username)) {
          next[user.username] = current[user.username];
        } else next[user.username] = false;
      });
      return next;
    });
  }, [users, settings.username]);

  const setNotice = (text = '', eventId = '') => {
    setMsg(text);
    if (text) notify?.({ ok: !/error|invalid|failed|forbidden/i.test(text), level: /error|invalid|failed|forbidden/i.test(text) ? 'error' : 'success', message: text, eventId });
  };

  const scanFiles = async () => {
    if (localTest) return;
    setScanning(true);
    setMsg('');
    try {
      const res = await api('/api/settings');
      setDiscovered(res.discovered || { caddyfiles: [], logfiles: [] });
    } catch (err) {
      setMsg(err.message);
    } finally {
      setScanning(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setMsg('');
    if (!canEdit) return;
    const nextLogPaths = form.logPaths.split('\n').map((x) => x.trim()).filter(Boolean);
    const nextAllowedOrigins = form.allowedOrigins.split('\n').map((x) => x.trim()).filter(Boolean);
    const nextTrustProxyHops = Number(form.trustProxyHops || 0);

    if (localTest) {
      setSettings({
        ...settings,
        configMode: form.configMode || 'api',
        caddyfilePath: form.caddyfilePath,
        caddyApiUrl: form.caddyApiUrl,
        aiEnabled: Boolean(form.aiEnabled),
        aiProvider: form.aiProvider,
        aiBaseUrl: form.aiBaseUrl,
        aiModel: form.aiModel,
        aiAllowPrivateBaseUrl: Boolean(form.aiAllowPrivateBaseUrl),
        hasAiApiKey: clearAiApiKey ? false : form.aiApiKey.trim() ? true : Boolean(settings.hasAiApiKey),
        hasCaddyApiToken: clearCaddyApiSecret ? false : form.caddyApiToken.trim() ? true : Boolean(settings.hasCaddyApiToken),
        hasCaddyApiSecret: clearCaddyApiSecret ? false : form.caddyApiToken.trim() ? true : Boolean(settings.hasCaddyApiSecret || settings.hasCaddyApiToken),
        logPaths: nextLogPaths,
        trustProxyHops: Number.isFinite(nextTrustProxyHops) && nextTrustProxyHops > 0 ? Math.floor(nextTrustProxyHops) : 0,
        allowRemoteSetup: Boolean(form.allowRemoteSetup),
        secureCookieMode: form.secureCookieMode || 'auto',
        allowedOrigins: nextAllowedOrigins,
      });
      setNotice('Saved in browser only.');
      return;
    }

    try {
      const payload = {
        configMode: form.configMode || 'api',
        caddyfilePath: form.caddyfilePath,
        caddyApiUrl: form.caddyApiUrl,
        logPaths: nextLogPaths,
      };
      if (form.caddyApiToken.trim()) payload.caddyApiSecret = form.caddyApiToken.trim();
      if (clearCaddyApiSecret) payload.caddyApiSecretClear = true;
      if (canAdmin) {
        payload.trustProxyHops = Number.isFinite(nextTrustProxyHops) && nextTrustProxyHops > 0 ? Math.floor(nextTrustProxyHops) : 0;
        payload.allowRemoteSetup = Boolean(form.allowRemoteSetup);
        payload.secureCookieMode = form.secureCookieMode || 'auto';
        payload.allowedOrigins = nextAllowedOrigins;
        payload.aiEnabled = Boolean(form.aiEnabled);
        payload.aiProvider = form.aiProvider;
        payload.aiBaseUrl = form.aiBaseUrl.trim();
        payload.aiModel = form.aiModel.trim();
        payload.aiAllowPrivateBaseUrl = Boolean(form.aiAllowPrivateBaseUrl);
        if (form.aiApiKey.trim()) payload.aiApiKey = form.aiApiKey.trim();
        if (clearAiApiKey) payload.aiApiKeyClear = true;
      }
      const r = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSettings(r.settings);
      setNotice('Settings saved.', r.event?.id || '');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const testAiProvider = async () => {
    if (!canAdmin || localTest) return;
    setTestingAi(true);
    setMsg('');
    try {
      const result = await api('/api/ai/settings/test', {
        method: 'POST',
        body: JSON.stringify({ provider: form.aiProvider, baseUrl: form.aiBaseUrl.trim(), model: form.aiModel.trim(), apiKey: form.aiApiKey.trim(), allowPrivateBaseUrl: Boolean(form.aiAllowPrivateBaseUrl) }),
      });
      setNotice(result.message || 'AI provider connection succeeded.');
    } catch (err) {
      setMsg(err.message);
      notify?.({ ok: false, level: 'error', message: err.message || 'AI provider test failed.' });
    } finally {
      setTestingAi(false);
    }
  };

  const testApiUrl = async () => {
    if (!canEdit) return;
    if (localTest) {
      notify?.({ ok: true, level: 'success', message: 'Local test mode: API URL looks good.' });
      return;
    }
    setTestingApi(true);
    setMsg('');
    try {
      const res = await api('/api/settings/test-api', {
        method: 'POST',
        body: JSON.stringify({
          caddyApiUrl: form.caddyApiUrl,
          caddyApiSecret: form.caddyApiToken.trim(),
        }),
      });
      notify?.({ ok: true, level: 'success', message: res.message || 'Connected to Caddy API.', eventId: res.event?.id || '' });
    } catch (err) {
      notify?.({ ok: false, level: 'error', message: err.message || 'Caddy API test failed.', eventId: err.payload?.event?.id || '' });
      setMsg(err.message);
    } finally {
      setTestingApi(false);
    }
  };

  const saveUpdateChannel = async (e) => {
    e.preventDefault();
    setMsg('');
    if (!canAdmin) return;

    if (localTest) {
      setSettings({ ...settings, updateChannel });
      setNotice('Update channel saved in browser only.');
      return;
    }

    try {
      const r = await api('/api/settings/update-channel', {
        method: 'PUT',
        body: JSON.stringify({ updateChannel }),
      });
      setSettings(r.settings);
      setNotice('Update channel saved.', r.event?.id || '');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const addUser = async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: userForm.username,
          password: userForm.password,
          role: userForm.role,
          allowedDomains: parseScopeText(userForm.allowedDomains),
          allowedCategories: parseScopeText(userForm.allowedCategories),
        }),
      });
      setUsers(res.users);
      setUserForm({ username: '', password: '', role: 'view', allowedDomains: '', allowedCategories: '' });
      setNotice('User added.', res.event?.id || '');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const updateUserRole = async (username, role) => {
    try {
      const res = await api(`/api/users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      setUsers(res.users);
      setNotice(`Updated ${username}.`, res.event?.id || '');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const saveUserAccess = async (username) => {
    const draft = userAccessDrafts[username] || { allowedDomains: '', allowedCategories: '' };
    try {
      const res = await api(`/api/users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: JSON.stringify({
          allowedDomains: parseScopeText(draft.allowedDomains),
          allowedCategories: parseScopeText(draft.allowedCategories),
        }),
      });
      setUsers(res.users);
      setNotice(`Saved access scope for ${username}.`, res.event?.id || '');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const removeUser = async (username) => {
    try {
      const res = await api(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
      setUsers(res.users);
      setNotice('User deleted.', res.event?.id || '');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const setAllUsersExpanded = (expanded) => {
    setExpandedUsers(Object.fromEntries(users.map((user) => [user.username, expanded])));
  };

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/account/password', { method: 'POST', body: JSON.stringify(passwordForm) });
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setNotice('Password updated.', res.event?.id || '');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const runDangerAction = async () => {
    if (!dangerModal.open || dangerModal.value.trim() !== settings.username) return;
    setDangerBusy(true);
    try {
      if (dangerModal.kind === 'reset-config') {
        const res = await api('/api/settings/reset-caddy-config', {
          method: 'POST',
          body: JSON.stringify({ username: dangerModal.value.trim() }),
        });
        setDangerModal({ open: false, kind: '', value: '' });
        setConfigFromReset(res);
        notify?.({ ok: true, level: 'warning', message: 'Caddy config reset to template.', eventId: res.event?.id || '' });
        return;
      }
      if (dangerModal.kind === 'reset-onboarding') {
        const res = await api('/api/settings/reset-onboarding', {
          method: 'POST',
          body: JSON.stringify({ username: dangerModal.value.trim() }),
        });
        setDangerModal({ open: false, kind: '', value: '' });
        notify?.({ ok: true, level: 'warning', message: 'CaddyUI reset to onboarding.', eventId: res.event?.id || '' });
        window.location.reload();
      }
    } catch (err) {
      setMsg(err.message);
    } finally {
      setDangerBusy(false);
    }
  };

  const setConfigFromReset = (res) => {
    if (!res?.parsed || !refreshConfig) return;
    refreshConfig();
  };

  const openDangerModal = (kind) => setDangerModal({ open: true, kind, value: '' });

  return (
    <section>
      <div className="settings-page-head">
        <h2>Settings</h2>
        <p>Connection, security, users, updates, and recovery tools.</p>
      </div>

      <div className="settings-overview">
        <div><span>Role</span><b>{settings.role || 'view'}</b></div>
        <div><span>Mode</span><b>{settings.configMode || 'api'}</b></div>
        <div><span>Caddy API URL</span><b>{settings.caddyApiUrl || 'not set'}</b></div>
        <div><span>Caddyfile</span><b>{settings.caddyfilePath || 'not set'}</b></div>
        <div><span>API secret</span><b>{(settings.hasCaddyApiSecret || settings.hasCaddyApiToken) ? 'configured' : 'not set'}</b></div>
        <div><span>Log paths</span><b>{configuredLogCount}</b></div>
        <div><span>Trusted proxy hops</span><b>{settings.trustProxyHops ?? 0}</b></div>
        <div><span>Update channel</span><b>{settings.updateChannel || 'stable'}</b></div>
      </div>

      <div className="settings-layout">
        <aside className="settings-subnav">
          {sectionItems.map(([id, label]) => (
            <button key={id} type="button" className={activeSection === id ? 'active' : ''} onClick={() => setActiveSection(id)}>
              {label}
            </button>
          ))}
        </aside>

        <div className="settings-panels">
          {msg && <Notice type={/error|invalid|failed|forbidden/i.test(msg) ? 'error' : 'success'}>{msg}</Notice>}

          {activeSection === 'connection' && (
            <form className="settings-form settings-card-grid" onSubmit={save}>
              <div className="settings-section-head">
                <h3>Connection</h3>
                <p>API mode is the default. File mode stays available when you want direct Caddyfile writes.</p>
              </div>
              <div className="settings-card">
                <h4>Config source</h4>
                <label>
                  Config mode
                  <select value={form.configMode} onChange={(e) => setForm({ ...form, configMode: e.target.value })} disabled={!canEdit}>
                    <option value="api">api</option>
                    <option value="file">file</option>
                  </select>
                </label>
                <label>
                  Caddyfile path
                  <input value={form.caddyfilePath} onChange={(e) => setForm({ ...form, caddyfilePath: e.target.value })} readOnly={!canEdit || form.configMode === 'api'} />
                </label>
                <div className="toolbar">
                  <button type="button" onClick={scanFiles} disabled={scanning}>{scanning ? 'Scanning...' : 'Scan Caddyfiles'}</button>
                  {discovered.caddyfiles.length > 0 && (
                    <select value="" onChange={(e) => e.target.value && setForm({ ...form, caddyfilePath: e.target.value })}>
                      <option value="">Select discovered Caddyfile</option>
                      {discovered.caddyfiles.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
                    </select>
                  )}
                </div>
              </div>

              <div className="settings-card">
                <h4>Caddy Admin API</h4>
                <label>
                  Caddy API URL
                  <div className="settings-inline-action">
                    <input value={form.caddyApiUrl} onChange={(e) => setForm({ ...form, caddyApiUrl: e.target.value })} readOnly={!canEdit} placeholder="http://127.0.0.1:2019" />
                    <button type="button" onClick={testApiUrl} disabled={!canEdit || testingApi}>{testingApi ? 'Testing...' : 'Test URL'}</button>
                  </div>
                </label>
                <label>
                  Caddy API secret
                  <input
                    type="password"
                    value={form.caddyApiToken}
                    onChange={(e) => {
                      setClearCaddyApiSecret(false);
                      setForm({ ...form, caddyApiToken: e.target.value });
                    }}
                    readOnly={!canEdit}
                    placeholder={(settings.hasCaddyApiSecret || settings.hasCaddyApiToken) ? 'Stored secret is set. Enter a new value to rotate it.' : 'Optional bearer secret'}
                  />
                </label>
                {(settings.hasCaddyApiSecret || settings.hasCaddyApiToken) && (
                  <label className="settings-toggle">
                    <input type="checkbox" checked={clearCaddyApiSecret} onChange={(e) => { setClearCaddyApiSecret(e.target.checked); if (e.target.checked) setForm({ ...form, caddyApiToken: '' }); }} disabled={!canEdit} />
                    Clear stored Caddy API secret on save
                  </label>
                )}
              </div>

              <div className="settings-card settings-card-wide">
                <h4>Logs</h4>
                <label>
                  Log paths
                  <textarea rows="8" value={form.logPaths} onChange={(e) => setForm({ ...form, logPaths: e.target.value })} readOnly={!canEdit} />
                </label>
                <div className="toolbar">
                  <button type="button" onClick={scanFiles} disabled={scanning}>{scanning ? 'Scanning...' : 'Scan log files'}</button>
                  {discovered.logfiles.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const lines = new Set(form.logPaths.split('\n').map((x) => x.trim()).filter(Boolean));
                        lines.add(e.target.value);
                        setForm({ ...form, logPaths: [...lines].join('\n') });
                      }}
                    >
                      <option value="">Add discovered log file</option>
                      {discovered.logfiles.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {canEdit && (
                <div className="settings-form-actions">
                  <button className="primary">Save connection settings</button>
                </div>
              )}
            </form>
          )}

          {activeSection === 'ai' && (
            <form className="settings-form settings-card-grid" onSubmit={save}>
              <div className="settings-section-head"><div><h3>AI assistant</h3><p>Connect a provider for guided proxy inspection and confirmed management actions.</p></div></div>
              <div className="settings-card settings-card-wide">
                <label className="check-row"><input type="checkbox" checked={Boolean(form.aiEnabled)} onChange={(e) => setForm({ ...form, aiEnabled: e.target.checked })} disabled={!canAdmin} />Enable AI assistant</label>
                <div className="settings-grid two">
                  <label>Provider<select value={form.aiProvider} onChange={(e) => setForm({ ...form, aiProvider: e.target.value })} disabled={!canAdmin}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic-compatible</option></select></label>
                  <label>Model<input value={form.aiModel} onChange={(e) => setForm({ ...form, aiModel: e.target.value })} readOnly={!canAdmin} placeholder={form.aiProvider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4.1-mini'} /></label>
                </div>
                <label>Base URL<input value={form.aiBaseUrl} onChange={(e) => setForm({ ...form, aiBaseUrl: e.target.value })} readOnly={!canAdmin} placeholder={form.aiProvider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'} /></label>
                <label>API key<input type="password" autoComplete="new-password" value={form.aiApiKey} onChange={(e) => { setForm({ ...form, aiApiKey: e.target.value }); if (e.target.value) setClearAiApiKey(false); }} readOnly={!canAdmin} placeholder={settings.hasAiApiKey ? 'Configured — enter a new key to rotate' : 'Enter provider API key'} /></label>
                {settings.hasAiApiKey && <label className="check-row"><input type="checkbox" checked={clearAiApiKey} onChange={(e) => { setClearAiApiKey(e.target.checked); if (e.target.checked) setForm({ ...form, aiApiKey: '' }); }} disabled={!canAdmin} />Clear configured AI API key when saving</label>}
                <div className="ai-private-warning"><label className="check-row"><input type="checkbox" checked={Boolean(form.aiAllowPrivateBaseUrl)} onChange={(e) => setForm({ ...form, aiAllowPrivateBaseUrl: e.target.checked })} disabled={!canAdmin} />Allow private/local provider URLs</label><small>Only enable this for a trusted Ollama, LM Studio, or LAN gateway. Cloud metadata and link-local endpoints remain blocked.</small></div>
                <div className="toolbar"><button type="button" onClick={testAiProvider} disabled={!canAdmin || testingAi || !form.aiBaseUrl.trim() || !form.aiModel.trim()}>{testingAi ? 'Testing...' : 'Test AI provider'}</button></div>
              </div>
              {canAdmin && (
                <div className="settings-form-actions">
                  <button type="submit" className="primary">Save AI settings</button>
                </div>
              )}
            </form>
          )}

          {activeSection === 'ai' && (
            <div className="settings-card">
              <div className="settings-section-head"><div><h3>AI assistant</h3><p>Connect a provider for guided proxy inspection and confirmed management actions.</p></div></div>
              <div className="settings-card-body">
                <label className="check-row"><input type="checkbox" checked={Boolean(form.aiEnabled)} onChange={(e) => setForm({ ...form, aiEnabled: e.target.checked })} disabled={!canAdmin} />Enable AI assistant</label>
                <div className="settings-grid two">
                  <label>Provider<select value={form.aiProvider} onChange={(e) => setForm({ ...form, aiProvider: e.target.value })} disabled={!canAdmin}><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic-compatible</option></select></label>
                  <label>Model<input value={form.aiModel} onChange={(e) => setForm({ ...form, aiModel: e.target.value })} readOnly={!canAdmin} placeholder={form.aiProvider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4.1-mini'} /></label>
                </div>
                <label>Base URL<input value={form.aiBaseUrl} onChange={(e) => setForm({ ...form, aiBaseUrl: e.target.value })} readOnly={!canAdmin} placeholder={form.aiProvider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'} /></label>
                <label>API key<input type="password" autoComplete="new-password" value={form.aiApiKey} onChange={(e) => { setForm({ ...form, aiApiKey: e.target.value }); if (e.target.value) setClearAiApiKey(false); }} readOnly={!canAdmin} placeholder={settings.hasAiApiKey ? 'Configured — enter a new key to rotate' : 'Enter provider API key'} /></label>
                {settings.hasAiApiKey && <label className="check-row"><input type="checkbox" checked={clearAiApiKey} onChange={(e) => { setClearAiApiKey(e.target.checked); if (e.target.checked) setForm({ ...form, aiApiKey: '' }); }} disabled={!canAdmin} />Clear configured AI API key when saving</label>}
                <div className="ai-private-warning"><label className="check-row"><input type="checkbox" checked={Boolean(form.aiAllowPrivateBaseUrl)} onChange={(e) => setForm({ ...form, aiAllowPrivateBaseUrl: e.target.checked })} disabled={!canAdmin} />Allow private/local provider URLs</label><small>Only enable this for a trusted Ollama, LM Studio, or LAN gateway. Cloud metadata and link-local endpoints remain blocked.</small></div>
                <div className="toolbar"><button type="button" onClick={testAiProvider} disabled={!canAdmin || testingAi || !form.aiBaseUrl.trim() || !form.aiModel.trim()}>{testingAi ? 'Testing...' : 'Test AI provider'}</button></div>
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <form className="settings-form settings-card-grid" onSubmit={save}>
              <div className="settings-section-head">
                <h3>Security</h3>
                <p>Trusted proxy handling, cookies, setup exposure, and extra origins.</p>
              </div>
              <div className="settings-card">
                <h4>Proxy and cookies</h4>
                <label>
                  Trust proxy hops
                  <input type="number" min="0" value={form.trustProxyHops} onChange={(e) => setForm({ ...form, trustProxyHops: e.target.value })} readOnly={!canAdmin} />
                </label>
                <label>
                  Cookie mode
                  <select value={form.secureCookieMode} onChange={(e) => setForm({ ...form, secureCookieMode: e.target.value })} disabled={!canAdmin}>
                    <option value="auto">auto</option>
                    <option value="secure">secure</option>
                    <option value="insecure">insecure</option>
                  </select>
                </label>
              </div>
              <div className="settings-card">
                <h4>Origin controls</h4>
                <label className="settings-toggle">
                  <input type="checkbox" checked={Boolean(form.allowRemoteSetup)} onChange={(e) => setForm({ ...form, allowRemoteSetup: e.target.checked })} disabled={!canAdmin} />
                  Allow first-time setup from public IPs
                </label>
                <label>
                  Additional allowed origins
                  <textarea rows="6" value={form.allowedOrigins} onChange={(e) => setForm({ ...form, allowedOrigins: e.target.value })} readOnly={!canAdmin} />
                </label>
              </div>
              {canEdit && (
                <div className="settings-form-actions">
                  <button className="primary">Save security settings</button>
                </div>
              )}
            </form>
          )}

          {activeSection === 'appearance' && (
            <div className="settings-form settings-card-grid">
              <div className="settings-section-head">
                <h3>Appearance</h3>
                <p>Local display preferences for this browser.</p>
              </div>
              <div className="settings-card">
                <h4>Theme mode</h4>
                <div className="theme-mode-control">
                  <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme?.('dark')}>Dark</button>
                  <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme?.('light')}>Light</button>
                </div>
              </div>
              <div className="settings-card">
                <h4>Theme color</h4>
                <div className="accent-color-grid">
                  {accentOptions.map(([id, label, color]) => (
                    <button
                      type="button"
                      key={id}
                      className={`accent-color-option ${accent === id ? 'active' : ''}`}
                      onClick={() => setAccent?.(id)}
                      aria-pressed={accent === id}
                    >
                      <span className="accent-swatch" style={{ '--swatch-color': color }} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'account' && (
            <form className="settings-form" onSubmit={changePassword}>
              <div className="settings-section-head">
                <h3>Password</h3>
                <p>Change your current account password.</p>
              </div>
              <label>
                Current password
                <input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} />
              </label>
              <label>
                New password
                <input type="password" minLength={8} value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} />
              </label>
              <div className="settings-form-actions">
                <button className="primary">Change password</button>
              </div>
            </form>
          )}

          {activeSection === 'users' && canAdmin && (
            <div className="settings-form users-section">
              <div className="settings-section-head">
                <h3>Users</h3>
                <p>Create users, set roles, and scope edit access by domain/category.</p>
              </div>
              <section className="users-create-card">
                <button type="button" className="users-accordion-toggle" onClick={() => setCreateUserOpen((open) => !open)} aria-expanded={createUserOpen}>
                  <span className="users-accordion-title">
                    <UserPlus size={18} />
                    <span>
                    <b>Create user</b>
                    <small>Add a local account. Scopes are optional.</small>
                    </span>
                  </span>
                  <span className="users-accordion-caret">{createUserOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                </button>
                {createUserOpen && (
                <form className="users-create-form users-accordion-panel" onSubmit={addUser}>
                  <label>
                    Username
                    <input placeholder="username" value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
                  </label>
                  <label>
                    Password
                    <input placeholder="password" type="password" minLength={8} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                  </label>
                  <label>
                    Role
                    <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                      <option value="view">view</option>
                      <option value="edit">edit</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>
                  <details className="users-scope-details users-field-wide">
                    <summary>Access scopes</summary>
                    <div className="user-scope-grid">
                      <label>
                        Allowed domains
                        <textarea
                          rows="3"
                          placeholder="example.com&#10;*.example.com"
                          value={userForm.allowedDomains}
                          onChange={(e) => setUserForm({ ...userForm, allowedDomains: e.target.value })}
                        />
                      </label>
                      <label>
                        Allowed categories
                        <textarea
                          rows="3"
                          placeholder="team-a, staging"
                          value={userForm.allowedCategories}
                          onChange={(e) => setUserForm({ ...userForm, allowedCategories: e.target.value })}
                        />
                      </label>
                    </div>
                  </details>
                  <div className="users-create-actions">
                    <button className="primary">Add user</button>
                  </div>
                </form>
                )}
              </section>

              <section className="users-list-card">
                <button type="button" className="users-accordion-toggle" onClick={() => setUserListOpen((open) => !open)} aria-expanded={userListOpen}>
                  <span className="users-accordion-title">
                    <UsersRound size={18} />
                    <span>
                    <b>Existing users</b>
                    <small>{users.length} account{users.length === 1 ? '' : 's'}. Role changes are immediate.</small>
                    </span>
                  </span>
                  <span className="users-accordion-caret">{userListOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                </button>
                {userListOpen && (
                <div className="users-accordion-panel">
                  {users.length === 0 && <p className="users-empty">No users found.</p>}
                  {users.length > 0 && (
                    <div className="users-list-tools">
                      <button type="button" onClick={() => setAllUsersExpanded(true)}><ChevronsDown size={15} />Expand all</button>
                      <button type="button" onClick={() => setAllUsersExpanded(false)}><ChevronsUp size={15} />Collapse all</button>
                    </div>
                  )}
                  <div className="users-list">
                    {users.map((user) => {
                      const userExpanded = Boolean(expandedUsers[user.username]);
                      const domainCount = parseScopeText(userAccessDrafts[user.username]?.allowedDomains || '').length;
                      const categoryCount = parseScopeText(userAccessDrafts[user.username]?.allowedCategories || '').length;
                      return (
                        <article key={user.username} className={`user-item ${userExpanded ? 'expanded' : ''}`}>
                          <div className="user-item-head">
                            <button
                              type="button"
                              className="user-item-toggle"
                              onClick={() => setExpandedUsers((current) => ({ ...current, [user.username]: !current[user.username] }))}
                              aria-expanded={userExpanded}
                            >
                              <span className="user-row-caret">{userExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>
                              <div className="user-item-title">
                                <h5>{user.username}</h5>
                                {user.username === settings.username && <span className="user-self-badge">Current account</span>}
                              </div>
                              <small>{domainCount} domain scope{domainCount === 1 ? '' : 's'} · {categoryCount} category scope{categoryCount === 1 ? '' : 's'}</small>
                            </button>
                            <label className="user-role-field">
                              Role
                              <select value={user.role} onChange={(e) => updateUserRole(user.username, e.target.value)}>
                                <option value="view">view</option>
                                <option value="edit">edit</option>
                                <option value="admin">admin</option>
                              </select>
                            </label>
                          </div>
                          {userExpanded && (
                          <>
                            <div className="user-scope-grid">
                              <label>
                                Allowed domains
                                <textarea
                                  rows="3"
                                  placeholder="example.com&#10;*.example.com"
                                  value={userAccessDrafts[user.username]?.allowedDomains || ''}
                                  onChange={(e) => setUserAccessDrafts((current) => ({
                                    ...current,
                                    [user.username]: {
                                      ...(current[user.username] || { allowedDomains: '', allowedCategories: '' }),
                                      allowedDomains: e.target.value,
                                    },
                                  }))}
                                />
                              </label>
                              <label>
                                Allowed categories
                                <textarea
                                  rows="3"
                                  placeholder="team-a, staging"
                                  value={userAccessDrafts[user.username]?.allowedCategories || ''}
                                  onChange={(e) => setUserAccessDrafts((current) => ({
                                    ...current,
                                    [user.username]: {
                                      ...(current[user.username] || { allowedDomains: '', allowedCategories: '' }),
                                      allowedCategories: e.target.value,
                                    },
                                  }))}
                                />
                              </label>
                            </div>
                            <div className="user-item-actions">
                              <button type="button" onClick={() => saveUserAccess(user.username)}><Save size={15} />Save access</button>
                              <button className="danger" type="button" onClick={() => removeUser(user.username)} disabled={user.username === settings.username}><Trash2 size={15} />Delete</button>
                            </div>
                          </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
                )}
              </section>
            </div>
          )}

          {activeSection === 'updates' && canAdmin && (
            <form className="settings-form" onSubmit={saveUpdateChannel}>
              <div className="settings-section-head">
                <h3>Updates</h3>
                <p>Stable and beta follow their release branches. Dev installs the most recent successful nightly build, never an unchecked branch tip.</p>
              </div>
              <label>
                Update channel
                <select value={updateChannel} onChange={(e) => { setUpdateChannel(e.target.value); setSettings((current) => ({ ...(current || {}), updateChannel: e.target.value })); }}>
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                  <option value="dev">dev (latest successful nightly)</option>
                </select>
              </label>
              <div className="settings-form-actions">
                <button className="primary">Save update channel</button>
              </div>
            </form>
          )}

          {activeSection === 'danger' && canAdmin && (
            <div className="settings-form settings-danger">
              <div className="settings-section-head">
                <h3>Danger zone</h3>
                <p>These actions are destructive. You will need to type your username to continue.</p>
              </div>
              <div className="settings-danger-actions">
                <div className="settings-danger-card">
                  <h4>Reset Caddy config</h4>
                  <p>Replaces the current config with the template config and keeps a backup when possible.</p>
                  <button type="button" className="danger" onClick={() => openDangerModal('reset-config')}>Reset Caddy config</button>
                </div>
                <div className="settings-danger-card">
                  <h4>Reset CaddyUI onboarding</h4>
                  <p>Clears users and returns the app to first-run onboarding.</p>
                  <button type="button" className="danger" onClick={() => openDangerModal('reset-onboarding')}>Reset CaddyUI</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <TypedConfirmModal
        open={dangerModal.open}
        busy={dangerBusy}
        title={dangerModal.kind === 'reset-config' ? 'Reset Caddy config' : 'Reset CaddyUI to onboarding'}
        message={dangerModal.kind === 'reset-config' ? 'This will overwrite the current config with the reset template.' : 'This will remove users and send the app back to onboarding.'}
        username={settings.username || ''}
        typedValue={dangerModal.value}
        onTypedValueChange={(value) => setDangerModal((current) => ({ ...current, value }))}
        confirmLabel={dangerModal.kind === 'reset-config' ? 'Reset config' : 'Reset CaddyUI'}
        onCancel={() => setDangerModal({ open: false, kind: '', value: '' })}
        onConfirm={runDangerAction}
      />
    </section>
  );
}
