import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { parseCaddyfile } from '../server/caddyParser.js';
import pkg from '../package.json';
import './styles.css';
import Proxies from './pages/Proxies.jsx';
import Middlewares from './pages/Middlewares.jsx';
import Configuration from './pages/Configuration.jsx';
import Logs from './pages/Logs.jsx';
import Tls from './pages/Tls.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { AuthGate, Notice, ReloadConfirmModal, Shell } from './components/common.jsx';
import AiAssistant from './components/AiAssistant.jsx';

const APP_VERSION = pkg.version;
const localTest = import.meta.env.DEV && import.meta.env.VITE_CADDYUI_LOCAL_TEST === '1';
const emptyConfig = { path: 'Caddyfile', content: '', parsed: parseCaddyfile(''), health: {} };
const localSettings = {
  userConfigured: true,
  caddyConfigured: true,
  configured: true,
  caddyApiUrl: 'http://127.0.0.1:2019',
  aiEnabled: true,
  aiProvider: 'openai',
  aiBaseUrl: 'http://127.0.0.1:11434',
  aiModel: 'local-test',
  aiAllowPrivateBaseUrl: true,
  hasAiApiKey: true,
  logPaths: ['/var/log/caddy/access.log'],
  updateChannel: 'stable',
  trustProxyHops: 0,
  allowRemoteSetup: false,
  secureCookieMode: 'auto',
  allowedOrigins: [],
  username: 'local',
  role: 'admin',
};

const api = async (path, options = {}) => {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.stderr || `Request failed: ${res.status}`);
  return data;
};

const canEditRole = (role) => role === 'edit' || role === 'admin';
const canAdminRole = (role) => role === 'admin';
const PAGE_IDS = new Set(['proxies', 'middlewares', 'configuration', 'tls', 'logs', 'settings']);
const pageFromHash = () => {
  const candidate = window.location.hash.replace(/^#\/?/, '').trim();
  return PAGE_IDS.has(candidate) ? candidate : 'proxies';
};
const UPDATE_STEPS = [
  ['target', 'Checking target'],
  ['queued', 'Starting installer'],
  ['source', 'Fetching update'],
  ['dependencies', 'Installing dependencies'],
  ['build', 'Building interface'],
  ['restart', 'Restarting service'],
  ['complete', 'Verifying update'],
  ['verified', 'Update verified'],
];

function parseValidationWarning(result = {}) {
  const raw = String(result?.stderr || '').trim();
  if (!raw) return { message: 'Validation failed.', canFormat: false };
  let message = raw;
  let canFormat = /not formatted/i.test(raw) && /caddy fmt/i.test(raw);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.warnings) && parsed.warnings.length) {
      message = parsed.warnings
        .map((warning) => {
          const file = warning?.file ? String(warning.file) : 'Caddyfile';
          const line = warning?.line ? `:${warning.line}` : '';
          return `${file}${line} ${String(warning?.message || 'Validation warning.')}`;
        })
        .join(' | ');
      canFormat = canFormat || parsed.warnings.some((warning) => /not formatted/i.test(String(warning?.message || '')));
    }
  } catch {}
  return { message, canFormat };
}

export default function App() {
  const [status, setStatus] = useState(localTest ? { settings: localSettings, authenticated: true, discovered: { caddyfiles: [], logfiles: [] } } : null);
  const [settings, setSettings] = useState(localTest ? localSettings : null);
  const [config, setConfig] = useState(localTest ? emptyConfig : null);
  const [health, setHealth] = useState(localTest ? {} : {});
  const [page, setPage] = useState(pageFromHash);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('caddyui-theme') || 'dark');
  const [error, setError] = useState('');
  const [appInfo, setAppInfo] = useState({ version: APP_VERSION, updateAvailable: false });
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateProgress, setUpdateProgress] = useState({ percent: 0, phase: 'target', elapsedSeconds: 0 });
  const [caddyBusy, setCaddyBusy] = useState(false);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [configLoading, setConfigLoading] = useState(false);

  const role = settings?.role || '';
  const canEdit = canEditRole(role) || localTest;
  const canAdmin = canAdminRole(role) || localTest;
  const activeUpdateStepIndex = UPDATE_STEPS.findIndex(([phase]) => phase === updateProgress.phase);

  const dismissNotification = (id) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  const pushNotification = (notification) => {
    const id = notification.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const entry = {
      durationMs: notification.durationMs ?? 5200,
      ...notification,
      id,
    };
    setNotifications((current) => [entry, ...current].slice(0, 6));
    if (entry.durationMs > 0) {
      window.setTimeout(() => dismissNotification(id), entry.durationMs);
    }
    return id;
  };

  const updateNotification = (id, patch) => {
    setNotifications((current) => current.map((notification) => (notification.id === id ? { ...notification, ...patch } : notification)));
  };

  const notifyConfigChangedNeedsReload = (prefix = 'Changes saved.') => {
    if (localTest) return;
    pushNotification({
      ok: true,
      level: 'success',
      message: `${prefix} Applied live via Caddy API.`,
    });
  };

  const refreshHealth = async () => {
    if (localTest) return;
    try { const data = await api('/api/proxies/health'); setHealth(data.health || {}); } catch {}
  };

  const refreshConfig = async () => {
    if (localTest) return;
    setError(''); setConfigLoading(true);
    try { const data = await api('/api/config'); setConfig((current) => ({ ...current, ...data })); refreshHealth(); }
    catch (e) { setError(e.message); }
    finally { setConfigLoading(false); }
  };

  const refreshAppStatus = async (check = false, updateChannel = '') => {
    if (localTest) return;
    try {
      const endpoint = check ? '/api/app/check-updates' : '/api/app/status';
      const opts = check
        ? { method: 'POST', body: JSON.stringify({ updateChannel: updateChannel || settings?.updateChannel || '' }) }
        : {};
      setAppInfo(await api(endpoint, opts));
    }
    catch (e) { setError(e.message); }
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('caddyui-theme', theme); }, [theme]);
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (!updating) return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setUpdateProgress((current) => {
        return {
          ...current,
          elapsedSeconds: Math.floor((Date.now() - started) / 1000),
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [updating]);
  useEffect(() => {
    if (localTest) {
      fetch('/local-test/Caddyfile').then((r) => (r.ok ? r.text() : Promise.reject(new Error('Missing local test Caddyfile')))).then((content) => { const parsed = parseCaddyfile(content); const h = Object.fromEntries(parsed.sites.map((site) => [site.id, { local: { online: false }, domain: { online: false } }])); setConfig({ path: 'Caddyfile', content, parsed, health: h }); setHealth(h); }).catch(() => {});
      return;
    }
    api('/api/status').then((s) => { setStatus(s); setSettings(s.settings); if (s.settings.configured) { refreshConfig(); refreshAppStatus(false); } }).catch((e) => setError(e.message));
  }, []);

  const validateCaddyGlobal = async () => {
    if (!canEdit) return;
    if (localTest) { pushNotification({ ok: true, message: 'Local test mode.' }); return; }
    setCaddyBusy(true); setError('');
    try {
      const result = await api('/api/config/validate', { method: 'POST', body: JSON.stringify({ content: config?.content || '' }) });
      if (result.ok) {
        pushNotification({ ok: true, level: 'success', message: result.stdout || 'Validation passed.' });
      } else {
        const parsedWarning = parseValidationWarning(result);
        pushNotification({
          ok: false,
          level: parsedWarning.canFormat ? 'warning' : 'error',
          message: parsedWarning.message || 'Validation failed.',
          actionId: parsedWarning.canFormat ? 'format-config' : '',
          actionLabel: parsedWarning.canFormat ? 'Run caddy fmt --overwrite' : '',
          actionBusy: false,
          durationMs: parsedWarning.canFormat ? 9000 : 6500,
        });
      }
    }
    catch (e) { pushNotification({ ok: false, message: e.message }); }
    finally { setCaddyBusy(false); }
  };

  const runFormatFixGlobal = async (notificationId) => {
    if (!canEdit) return;
    if (localTest) {
      pushNotification({ ok: false, level: 'error', message: 'Formatting fix is not available in local test mode.' });
      return;
    }
    if (notificationId) updateNotification(notificationId, { actionBusy: true });
    setError('');
    try {
      const formatResult = await api('/api/config/format', {
        method: 'POST',
        body: JSON.stringify({ content: config?.content || '' }),
      });
      if (!formatResult.changed) {
        dismissNotification(notificationId);
        pushNotification({ ok: true, level: 'success', message: 'Config is already formatted.' });
        return;
      }
      const nextContent = String(formatResult.content || '');
      const saved = await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ content: nextContent, validate: true }),
      });
      setConfig((current) => ({ ...current, content: nextContent, parsed: saved.parsed, health: saved.health || current.health }));
      dismissNotification(notificationId);
      notifyConfigChangedNeedsReload('Formatted and saved config.');
    } catch (e) {
      if (notificationId) updateNotification(notificationId, { actionBusy: false });
      pushNotification({ ok: false, level: 'error', message: e.message || 'Formatting fix failed.' });
    } finally {
    }
  };

  const reloadCaddyGlobal = async () => {
    if (!canEdit) return;
    if (localTest) { pushNotification({ ok: true, message: 'Local test mode.' }); setReloadConfirmOpen(false); return; }
    setCaddyBusy(true); setError('');
    try { const result = await api('/api/config/reload', { method: 'POST' }); pushNotification({ ok: result.ok, message: result.ok ? (result.stdout || 'Reloaded Caddy.') : (result.stderr || 'Reload failed.') }); setReloadConfirmOpen(false); }
    catch (e) { pushNotification({ ok: false, message: e.message }); }
    finally { setCaddyBusy(false); }
  };

  if (!status) return <div className="loading"><Loader2 className="spin" /> Loading CaddyUI...</div>;
  if (!localTest && (!status.authenticated || !settings?.configured)) return <AuthGate status={status} onReady={(data) => { setStatus((prev) => ({ ...prev, ...data, settings: data.settings, authenticated: true, discovered: data.discovered || prev?.discovered })); setSettings(data.settings); if (data.settings.configured) { refreshConfig(); refreshAppStatus(false); } }} api={api} />;

  const logout = async () => { if (localTest) { location.reload(); return; } await api('/api/logout', { method: 'POST' }); location.reload(); };
  const navigatePage = (nextPage) => {
    if (!PAGE_IDS.has(nextPage)) return;
    setPage(nextPage);
    window.history.pushState(null, '', `#/${nextPage}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const checkUpdates = async () => {
    setCheckingUpdates(true);
    try {
      await refreshAppStatus(true, settings?.updateChannel || '');
    } finally {
      setCheckingUpdates(false);
    }
  };
  const runUpdate = async () => {
    setUpdating(true);
    setUpdateMessage('Preparing update...');
    setUpdateProgress({ percent: 6, phase: 'target', elapsedSeconds: 0 });
    setError('');
    try {
      const updateChannel = settings?.updateChannel || '';
      let baseline = appInfo;
      try {
        baseline = await api('/api/app/check-updates', {
          method: 'POST',
          body: JSON.stringify({ updateChannel }),
        });
        setAppInfo(baseline);
      } catch {}
      const baselineCommit = baseline?.localCommit || '';
      const baselineVersion = baseline?.version || baseline?.localVersion || APP_VERSION;
      const targetVersion = baseline?.availableVersion || baseline?.remoteVersion || '';
      setUpdateMessage(targetVersion ? `Updating to ${targetVersion}...` : 'Updating...');
      setUpdateProgress((current) => ({ ...current, percent: Math.max(current.percent, 10), phase: 'target' }));

      await api('/api/app/update', {
        method: 'POST',
        body: JSON.stringify({ updateChannel }),
      });
      setUpdateMessage('Installer started. Waiting for its first progress update...');
      setUpdateProgress((current) => ({ ...current, percent: Math.max(current.percent, 12), phase: 'queued' }));
      const started = Date.now();
      let confirmedReadyCount = 0;
      while (Date.now() - started < 240000) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        try {
          const updateStatus = await api('/api/app/update-status');
          if (updateStatus.progress) {
            const progress = updateStatus.progress;
            setUpdateProgress((current) => ({
              ...current,
              percent: Math.max(current.percent, progress.percent),
              phase: progress.phase,
            }));
            setUpdateMessage((current) => progress.message || current);
          }
          const status = await api('/api/app/check-updates', {
            method: 'POST',
            body: JSON.stringify({ updateChannel }),
          });
          setAppInfo(status);
          const commitChanged = Boolean(
            baselineCommit &&
            status.localCommit &&
            baselineCommit !== status.localCommit
          );
          const versionChanged = Boolean(
            baselineVersion &&
            status.version &&
            baselineVersion !== status.version
          );
          const branchAligned = status.updateChannel === 'dev'
            ? ['dev', 'caddyui-nightly'].includes(status.currentBranch)
            : !status.branch || !status.currentBranch || status.branch === status.currentBranch;
          const upToDate =
            status.updateAvailable === false &&
            Boolean(status.localCommit) &&
            Boolean(status.remoteCommit) &&
            status.localCommit === status.remoteCommit;
          if (upToDate && branchAligned && (commitChanged || versionChanged || !baseline?.updateAvailable)) {
            confirmedReadyCount += 1;
          } else {
            confirmedReadyCount = 0;
          }
          if (status.updateAvailable) {
            if (!updateStatus.progress) setUpdateMessage(`Installing update ${status.availableVersion || status.remoteVersion || ''}...`);
          } else {
            if (!updateStatus.progress) setUpdateMessage('Waiting for updated app to come online...');
          }
          if (confirmedReadyCount >= 2) {
            const nextVersion = status.version || status.localVersion || targetVersion || baselineVersion;
            setAppInfo((prev) => ({
              ...prev,
              ...status,
              version: nextVersion,
              localVersion: nextVersion,
              availableVersion: nextVersion,
              remoteVersion: status.remoteVersion || nextVersion,
              updateAvailable: false,
            }));
            setUpdateProgress((current) => ({ ...current, percent: 100, phase: 'verified' }));
            setUpdateMessage('Update verified. Reloading CaddyUI...');
            pushNotification({ ok: true, message: `Updated to ${nextVersion}. Reloading...`, durationMs: 3000 });
            const url = new URL(window.location.href);
            url.searchParams.set('v', String(Date.now()));
            window.location.replace(url.toString());
            return;
          }
        } catch {
          confirmedReadyCount = 0;
          setUpdateMessage('CaddyUI is restarting. Waiting for the service to return...');
        }
      }
      setUpdating(false);
      setUpdateMessage('');
      setUpdateProgress({ percent: 0, phase: 'target', elapsedSeconds: 0 });
      pushNotification({ ok: false, message: 'Update is still running or not ready yet. Check install log.' });
    } catch (e) {
      setError(e.message);
      setUpdating(false);
      setUpdateMessage('');
      setUpdateProgress({ percent: 0, phase: 'target', elapsedSeconds: 0 });
    }
  };

  return (
    <Shell
      page={page}
      setPage={navigatePage}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      user={settings.username}
      onLogout={logout}
      theme={theme}
      setTheme={setTheme}
      appInfo={appInfo}
      onCheckUpdates={checkUpdates}
      onRunUpdate={runUpdate}
      canUpdate={canAdmin}
      checkingUpdates={checkingUpdates}
      updating={updating}
      canEdit={canEdit}
      onValidateCaddy={validateCaddyGlobal}
      onConfirmReloadCaddy={() => setReloadConfirmOpen(true)}
      caddyBusy={caddyBusy}
      appVersion={APP_VERSION}
      notifications={notifications}
      onDismissNotification={dismissNotification}
      onClearNotifications={() => setNotifications([])}
      onNotificationAction={(notificationId) => {
        const current = notifications.find((notification) => notification.id === notificationId);
        if (current?.actionId === 'format-config') runFormatFixGlobal(notificationId);
        if (current?.actionId === 'reload-caddy') setReloadConfirmOpen(true);
      }}
    >
      {error && <Notice type="error">{error}</Notice>}
      {updating && (
        <div className="updating-screen">
          <div className="updating-card">
            <h3>Updating CaddyUI</h3>
            <p>{updateMessage || 'Please wait...'}</p>
            <div className="update-progress-meta"><span>{updateProgress.percent}%</span><span>{formatElapsed(updateProgress.elapsedSeconds)} elapsed</span></div>
            <div className="update-progress-track" role="progressbar" aria-label="Update progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={updateProgress.percent}>
              <span style={{ width: `${updateProgress.percent}%` }} />
            </div>
            <ol className="update-steps">
              {UPDATE_STEPS.map(([phase, label], index) => {
                return <li key={phase} className={activeUpdateStepIndex > index ? 'complete' : activeUpdateStepIndex === index ? 'active' : ''}><span>{activeUpdateStepIndex > index ? '✓' : index + 1}</span>{label}</li>;
              })}
            </ol>
            <small>Progress only advances when the installer reports a completed phase. Elapsed time continues while CaddyUI restarts.</small>
          </div>
        </div>
      )}
      {page === 'proxies' && (
        <Proxies
          config={config}
          refresh={refreshConfig}
          refreshHealth={refreshHealth}
          setConfig={setConfig}
          canEdit={canEdit}
          theme={theme}
          health={health}
          loading={configLoading}
          api={api}
          onConfigChanged={notifyConfigChangedNeedsReload}
        />
      )}
      {page === 'middlewares' && (
        <Middlewares
          config={config}
          setConfig={setConfig}
          canEdit={canEdit}
          theme={theme}
          api={api}
          onConfigChanged={notifyConfigChangedNeedsReload}
        />
      )}
      {page === 'configuration' && (
        <Configuration
          config={config}
          setConfig={setConfig}
          refresh={refreshConfig}
          canEdit={canEdit}
          theme={theme}
          api={api}
          onConfigChanged={notifyConfigChangedNeedsReload}
        />
      )}
      {page === 'tls' && <Tls api={api} canAdmin={canAdmin} setConfig={setConfig} onConfigChanged={notifyConfigChangedNeedsReload} />}
      {page === 'logs' && <Logs api={api} />}
      {page === 'settings' && (
        <SettingsPage settings={settings} setSettings={setSettings} canEdit={canEdit} canAdmin={canAdmin} api={api} notify={pushNotification} refreshConfig={refreshConfig} setStatus={setStatus} />
      )}
      <ReloadConfirmModal
        open={reloadConfirmOpen}
        busy={caddyBusy}
        onCancel={() => setReloadConfirmOpen(false)}
        onConfirm={reloadCaddyGlobal}
      />
      <AiAssistant
        api={api}
        settings={settings}
        canAdmin={canAdmin}
        notify={pushNotification}
        onOpenSettings={() => navigatePage('settings')}
        onActionComplete={(result) => {
          if (result?.parsed) setConfig((current) => ({ ...current, parsed: result.parsed }));
          refreshConfig();
          if (result?.reloadSuggested) pushNotification({ ok: true, level: 'warning', message: 'Proxy change saved. Reload Caddy to apply it.', actionLabel: 'Reload', actionId: 'reload-caddy', eventId: result.event?.id || '' });
          if (result?.requiresHeaderReload) setReloadConfirmOpen(true);
        }}
      />
    </Shell>
  );
}

function formatElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
