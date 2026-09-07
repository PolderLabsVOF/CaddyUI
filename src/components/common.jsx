import React, { memo, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Download, FileCode2, KeyRound, Layers3, Loader2, LogOut, Menu, MessageSquare, Moon, MoreHorizontal, Pencil, Power, RefreshCw, ScrollText, ServerCog, Settings, Shield, ShieldCheck, SidebarClose, Sun, Trash2, X } from 'lucide-react';
import { updateSimpleProxy } from '../../server/caddyParser.js';

export const pageItems = [
  ['proxies', ServerCog, 'Proxies'],
  ['middlewares', Layers3, 'Middlewares'],
  ['caddy', Activity, 'Runtime'],
  ['tls', ShieldCheck, 'TLS'],
  ['logs', ScrollText, 'Logs'],
  ['settings', Settings, 'Settings'],
];

export function Notice({ type = 'info', children }) {
  return <div className={`notice ${type}`}>{type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span>{children}</span></div>;
}

export function Shell({ children, page, setPage, collapsed, setCollapsed, user, onLogout, theme, setTheme, appInfo, onCheckUpdates, onRunUpdate, canUpdate, checkingUpdates, updating, canEdit, onValidateCaddy, onConfirmReloadCaddy, caddyBusy, appVersion, notifications = [], onDismissNotification, onNotificationAction, onClearNotifications }) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const activeVersion = appInfo?.version || appInfo?.localVersion || appVersion;
  const targetVersion = appInfo?.availableVersion || appInfo?.remoteVersion || '';
  const shownVersion = updating && targetVersion ? targetVersion : activeVersion;
  const openFeedback = () => {
    window.location.href = 'https://github.com/PolderLabsVOF/CaddyUI/issues/new/choose';
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <button className="icon-button sidebar-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            {collapsed ? <Menu /> : <SidebarClose />}
          </button>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="logo">Caddy<span>UI</span></span>
          <span className="app-version">v{shownVersion}</span>
        </div>
        <div className="top-actions desktop-actions">
          {canEdit && (
            <>
              <button onClick={onValidateCaddy} disabled={caddyBusy}>Validate</button>
              <button onClick={onConfirmReloadCaddy} disabled={caddyBusy}>Reload Caddy</button>
            </>
          )}
          <span className="pill"><Shield size={14} />{user || 'user'}</span>
          <button
            className="icon-button"
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button onClick={onLogout}>Logout</button>
        </div>
        <button type="button" className="icon-button mobile-actions-toggle" aria-label="Open quick actions" aria-expanded={mobileActionsOpen} onClick={() => setMobileActionsOpen(true)}><Menu size={20} /></button>
      </header>
      {mobileActionsOpen && <div className="mobile-actions-backdrop" onMouseDown={() => setMobileActionsOpen(false)}>
        <aside className="mobile-actions-sheet" aria-label="Quick actions" onMouseDown={(event) => event.stopPropagation()}>
          <div className="mobile-actions-head"><div><span className="eyebrow">Signed in</span><strong>{user || 'user'}</strong></div><button type="button" className="icon-button" onClick={() => setMobileActionsOpen(false)} aria-label="Close quick actions"><X size={19} /></button></div>
          {canEdit && <div className="mobile-action-grid">
            <button onClick={() => { onValidateCaddy(); setMobileActionsOpen(false); }} disabled={caddyBusy}><CheckCircle2 size={18} />Validate config</button>
            <button onClick={() => { onConfirmReloadCaddy(); setMobileActionsOpen(false); }} disabled={caddyBusy}><RefreshCw size={18} />Reload Caddy</button>
          </div>}
          <button className="mobile-action-row" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}Use {theme === 'light' ? 'dark' : 'light'} theme</button>
          <button className="mobile-action-row" onClick={onCheckUpdates} disabled={checkingUpdates || updating}><RefreshCw size={18} />{checkingUpdates ? 'Checking for updates…' : `Check updates · v${shownVersion}`}</button>
          {canUpdate && appInfo?.updateAvailable && <button className="mobile-action-row primary" onClick={() => { onRunUpdate(); setMobileActionsOpen(false); }} disabled={updating}>Update to v{targetVersion}</button>}
          <button className="mobile-action-row danger" onClick={onLogout}><LogOut size={18} />Sign out</button>
        </aside>
      </div>}
      {notifications.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {notifications.length > 1 && (
            <div className="toast-stack-actions">
              <button type="button" className="toast-clear-button" onClick={onClearNotifications}>Clear all</button>
            </div>
          )}
          {notifications.map((notification, index) => {
            const depth = Math.min(index, 5);
            const scale = Math.max(1 - depth * 0.045, 0.8);
            const surfaceMix = `${Math.min(depth * 14, 56)}%`;
            const textMix = `${Math.min(depth * 16, 62)}%`;
            const borderMix = `${Math.min(depth * 12, 48)}%`;
            return (
              <div
                key={notification.id}
                className={`top-feedback toast-card ${notification.level || (notification.ok ? 'success' : 'error')}`}
                style={{
                  zIndex: Math.max(20 - depth, 1),
                  transform: `scale(${scale})`,
                  '--toast-surface-mix': surfaceMix,
                  '--toast-text-mix': textMix,
                  '--toast-border-mix': borderMix,
                }}
              >
                {notification.level === 'warning' ? <AlertTriangle size={16} /> : notification.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                <span>{notification.message}</span>
                {notification.actionLabel && onNotificationAction && (
                  <button
                    type="button"
                    className="top-feedback-action"
                    onClick={() => onNotificationAction(notification.id)}
                    disabled={Boolean(notification.actionBusy)}
                  >
                    {notification.actionBusy ? 'Running...' : notification.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button top-feedback-close"
                  onClick={() => onDismissNotification?.(notification.id)}
                  aria-label="Dismiss message"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div>
          {pageItems.map(([id, Icon, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button type="button" className="sidebar-feedback" onClick={openFeedback}>
            <MessageSquare size={18} />
            <span>Feedback</span>
          </button>
          <div className="sidebar-footer">
          <div className="sidebar-meta">
            <span className="sidebar-version">v{shownVersion}</span>
            <span className={`sidebar-status ${appInfo?.updateAvailable ? 'update' : 'current'}`}>
              {updating ? 'Updating' : appInfo?.updateAvailable ? `Update v${appInfo?.availableVersion || appInfo?.remoteVersion || appInfo?.version || appVersion}` : 'Current'}
            </span>
          </div>
          <div className="sidebar-actions">
            <button type="button" onClick={onCheckUpdates} disabled={checkingUpdates || updating}>
              {checkingUpdates ? 'Checking...' : 'Check updates'}
            </button>
            {canUpdate && appInfo?.updateAvailable && (
              <button type="button" className="primary" onClick={onRunUpdate} disabled={updating}>
                {updating ? 'Updating...' : `Update to v${appInfo?.availableVersion || appInfo?.remoteVersion || appInfo?.version || appVersion}`}
              </button>
            )}
          </div>
          </div>
        </div>
      </aside>
      <main id="main-content" className={`content ${collapsed ? 'wide' : ''}`}>{children}</main>
      <nav className="mobile-nav" aria-label="Primary navigation">
        {pageItems.map(([id, Icon, label]) => (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function AuthGate({ status, onReady, api }) {
  const needsLogin = status?.settings?.userConfigured && !status?.authenticated;
  const needsConfig = status?.settings?.userConfigured && status?.authenticated && !status?.settings?.caddyConfigured;
  const discovered = status?.discovered || { caddyfiles: [], logfiles: [] };
  const [userForm, setUserForm] = useState({ username: '', password: '', setupToken: '' });
  const [configForm, setConfigForm] = useState({ caddyApiUrl: status?.settings?.caddyApiUrl || 'http://127.0.0.1:2019', logPaths: (discovered.logfiles || []).map((f) => f.path).join('\n') });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submitUser = async (e) => { e.preventDefault(); setBusy(true); setError(''); try { const path = needsLogin ? '/api/login' : '/api/setup/user'; const payload = needsLogin ? { username: userForm.username, password: userForm.password } : userForm; onReady(await api(path, { method: 'POST', body: JSON.stringify(payload) })); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const submitConfig = async (e) => { e.preventDefault(); setBusy(true); setError(''); try { onReady(await api('/api/setup/config', { method: 'POST', body: JSON.stringify({ caddyApiUrl: configForm.caddyApiUrl, logPaths: configForm.logPaths.split('\n').map((x) => x.trim()).filter(Boolean) }) })); } catch (err) { setError(err.message); } finally { setBusy(false); } };

  if (needsConfig) return <div className="auth-page"><form className="auth-card" onSubmit={submitConfig}><h1>CaddyUI</h1><p>Connect CaddyUI to the Caddy Admin API and choose the logs you want to inspect.</p>{error && <Notice type="error">{error}</Notice>}<label>Caddy API URL<input value={configForm.caddyApiUrl} onChange={(e) => setConfigForm({ ...configForm, caddyApiUrl: e.target.value })} placeholder="http://127.0.0.1:2019" /></label><label>Log paths, one per line<textarea rows="5" value={configForm.logPaths} placeholder="/var/log/caddy/access.log" onChange={(e) => setConfigForm({ ...configForm, logPaths: e.target.value })} /></label>{discovered.logfiles?.length > 0 && <div className="discover"><b>Discovered log files</b>{discovered.logfiles.map((f) => <button type="button" key={f.path} onClick={() => { const lines = new Set(configForm.logPaths.split('\n').map((x) => x.trim()).filter(Boolean)); lines.add(f.path); setConfigForm({ ...configForm, logPaths: [...lines].join('\n') }); }}>{f.path}</button>)}</div>}<button className="primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <FileCode2 size={16} />}Connect Caddy API</button></form></div>;

  return <div className="auth-page"><form className="auth-card" onSubmit={submitUser}><h1>CaddyUI</h1><p>{needsLogin ? 'Sign in to continue.' : 'First create the admin user. The Caddy Admin API connection is configured next.'}</p>{error && <Notice type="error">{error}</Notice>}<label>Username<input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></label><label>Password<input type="password" minLength={8} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></label>{!needsLogin && status?.settings?.setupTokenRequired && <label>Setup token<input value={userForm.setupToken} onChange={(e) => setUserForm({ ...userForm, setupToken: e.target.value })} /></label>}<button className="primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <KeyRound size={16} />}{needsLogin ? 'Login' : 'Create admin account'}</button></form></div>;
}

export function ConfirmModal({ confirm, onCancel, onConfirm }) {
  if (!confirm) return null;
  return <div className="confirm-layer" onMouseDown={onCancel}><div className="confirm-popover" style={{ left: confirm.x, top: confirm.y }} onMouseDown={(e) => e.stopPropagation()}><h3>{confirm.title}</h3><p>{confirm.message}</p><div className="confirm-actions"><button className="danger" onClick={onConfirm}>Delete</button><button onClick={onCancel}>Cancel</button></div></div></div>;
}

export function ReloadConfirmModal({ open, busy, onCancel, onConfirm }) {
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={onCancel}><div className="edit-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><h3>Reload Caddy</h3></div><p>Apply current configuration and reload now?</p><div className="toolbar"><button className="primary" onClick={onConfirm} disabled={busy}>{busy ? 'Reloading...' : 'Reload'}</button><button onClick={onCancel} disabled={busy}>Cancel</button></div></div></div>;
}

export function UpdateConfirmModal({ open, currentVersion, targetVersion, channel, onCancel, onConfirm }) {
  if (!open) return null;
  const versionLabel = (value) => String(value || '').startsWith('v') ? String(value) : `v${value}`;
  const current = currentVersion ? versionLabel(currentVersion) : 'Unknown';
  const target = targetVersion ? versionLabel(targetVersion) : 'Latest verified build';
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="edit-modal update-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">Software update</span>
            <h3 id="update-confirm-title">Start CaddyUI update?</h3>
          </div>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
        <p>CaddyUI will download the verified build, rebuild the interface, and restart its service. The control panel will be briefly unavailable.</p>
        <dl className="update-confirm-summary">
          <div><dt>Current</dt><dd>{current}</dd></div>
          <div><dt>Target</dt><dd>{target}</dd></div>
          <div><dt>Channel</dt><dd>{channel || 'stable'}</dd></div>
        </dl>
        <div className="update-confirm-actions">
          <button type="button" onClick={onCancel}>Keep current version</button>
          <button type="button" className="primary" onClick={onConfirm}><Download size={16} />Start update</button>
        </div>
      </div>
    </div>
  );
}

export function TypedConfirmModal({ open, busy, title, message, username, typedValue, onTypedValueChange, confirmLabel = 'Confirm', onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="edit-modal typed-confirm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" onClick={onCancel} disabled={busy}>Close</button>
        </div>
        <p>{message}</p>
        <label>
          Type <b>{username}</b> to confirm
          <input value={typedValue} onChange={(e) => onTypedValueChange(e.target.value)} autoFocus />
        </label>
        <div className="toolbar">
          <button className="danger" type="button" onClick={onConfirm} disabled={busy || typedValue.trim() !== username}>
            {busy ? 'Working...' : confirmLabel}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export const deleteConfirm = (event, title, message, action) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return { title, message, action, x: Math.min(rect.left, window.innerWidth - 430), y: Math.min(rect.bottom + 8, window.innerHeight - 170) };
};

export function StatCards({ parsed }) {
  const stats = parsed?.summary || {};
  return <div className="stats"><div><b>{stats.sites || 0}</b><span>Sites</span></div><div><b>{stats.proxies || 0}</b><span>Reverse proxies</span></div><div><b>{stats.snippets || 0}</b><span>Snippets</span></div><div><b>{stats.middleware || 0}</b><span>Imports used</span></div></div>;
}

export const rootDomain = (address = '') => {
  const host = address.replace(/^https?:\/\//, '').replace(/:.*/, '').trim();
  const parts = host.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : host || 'Other';
};

function localLikeHost(host = '') {
  const clean = String(host || '').replace(/^\[|\]$/g, '');
  return (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(clean) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(clean)
  );
}

function proxyHostHref(address = '') {
  const raw = String(address || '').trim();
  if (!raw) return '';
  if (/[{}*]/.test(raw)) return '';
  try {
    const direct = new URL(raw);
    if (direct.protocol === 'http:' || direct.protocol === 'https:') return direct.toString();
    return '';
  } catch {}

  const candidate = raw.replace(/^\/+/, '');
  const hostPort = candidate.split('/')[0];
  if (!hostPort || /\s/.test(hostPort)) return '';
  const hostOnly = hostPort.replace(/:\d+$/, '');
  const scheme = localLikeHost(hostOnly) ? 'http' : 'https';
  try {
    return new URL(`${scheme}://${hostPort}`).toString();
  } catch {
    return '';
  }
}

export const selectedImportNames = (value) => String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
export const selectedTagNames = (value) => {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
};
export const normalizeLogging = (logging = {}) => ({ mode: logging?.mode || 'none', path: logging?.path || '' });

export const findBlockRange = (content, line) => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const start = Number(line) - 1;
  if (start < 0 || start >= lines.length) return null;
  let depth = 0;
  let end = start;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) { if (ch === '{') depth += 1; if (ch === '}') depth -= 1; }
    if (depth === 0) { end = i; break; }
  }
  return { lines, start, end };
};

export const replaceBlockAtLine = (content, line, blockText) => {
  const range = findBlockRange(content, line);
  if (!range) return content;
  range.lines.splice(range.start, range.end - range.start + 1, ...String(blockText || '').replace(/\r\n/g, '\n').split('\n'));
  return range.lines.join('\n');
};

export const readBlockAtLine = (content, line) => {
  const range = findBlockRange(content, line);
  return range ? range.lines.slice(range.start, range.end + 1).join('\n') : '';
};

export const previewProxyBlock = (content, draft) => {
  try {
    const next = updateSimpleProxy(content, { siteLine: draft.line, host: draft.host, upstream: draft.upstream, imports: selectedImportNames(draft.imports), logging: { mode: draft.logMode, path: draft.logPath }, tags: selectedTagNames(draft.tags), category: draft.category, description: draft.description, disabled: Boolean(draft.disabled) });
    return readBlockAtLine(next, draft.line) || draft.rawBlock || '';
  } catch {
    return draft.rawBlock || '';
  }
};

export function MiddlewarePicker({ snippets, value, onChange }) {
  const selected = selectedImportNames(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const handle = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [open]);
  if (!snippets.length) return null;
  const toggle = (name) => {
    const set = new Set(selected);
    if (set.has(name)) set.delete(name); else set.add(name);
    onChange([...set].join(', '));
  };
  return (
    <div className="import-dropdown" ref={containerRef}>
      <button type="button" className="import-dropdown-trigger" onClick={() => setOpen((v) => !v)}>
        {selected.length ? `${selected.length} selected` : 'Select imports'}
      </button>
      {open && (
        <div className="import-dropdown-menu">
          {snippets.map((s) => (
            <label key={s.name} className="import-option">
              <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggle(s.name)} />
              <span>{s.name}</span>
              <small>{s.inferredType}</small>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export const StatusDot = ({ check, disabled = false }) => {
  if (disabled || check?.disabled) return <span className="status-dot disabled">disabled</span>;
  if (!check) return <span className="status-dot pending">checking</span>;
  return <span className={`status-dot ${check.online ? 'online' : 'offline'}`} title={check.error || undefined}>{check.online ? 'online' : 'offline'}</span>;
};

export const ProxyRow = memo(function ProxyRow({ site, healthCheck, canEdit, onEdit, onDelete, onToggleDisabled }) {
  const addresses = Array.isArray(site.addresses) ? site.addresses : [];
  const description = String(site.description || '').trim();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div className={`proxy-row ${site.disabled ? 'disabled' : ''}`}>
      <div className={`proxy-row-main ${canEdit ? 'clickable' : ''}`} onClick={canEdit ? onEdit : undefined} role={canEdit ? 'button' : undefined} tabIndex={canEdit ? 0 : undefined} onKeyDown={canEdit ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } } : undefined}>
        <span className="proxy-host" data-label="Host">
          {addresses.length > 0
            ? addresses.map((address, index) => {
              const href = proxyHostHref(address);
              const key = `${site.id || site.line || 'site'}-address-${index}`;
              return (
                <React.Fragment key={key}>
                  {index > 0 ? ', ' : ''}
                  {href ? (
                    <a className="proxy-host-link" href={href} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                      {address}
                    </a>
                  ) : (
                    <span>{address}</span>
                  )}
                </React.Fragment>
              );
            })
            : 'none'}
          {description && <small className="proxy-description">{description}</small>}
        </span>
        <span className="proxy-target" data-label="Upstream" title={site.proxies[0]?.upstreams?.join(' ') || 'No upstream'}>{site.proxies[0]?.upstreams?.join(' ') || 'no upstream'}</span>
        <div className="proxy-local" data-label="Local">
          <StatusDot check={healthCheck} disabled={site.disabled} />
        </div>
        <span className="proxy-category proxy-meta-value" data-label="Category">{site.category || 'none'}</span>
        <span className="proxy-tags proxy-meta-value" data-label="Tags" title={(site.tags || []).join(', ')}>{(site.tags || []).join(', ') || 'none'}</span>
        <span className="proxy-mw proxy-meta-value" data-label="Imports" title={[...site.imports.map((i) => i.name), ...(site.proxies[0]?.imports?.map((i) => i.name) || [])].join(', ')}>{[...site.imports.map((i) => i.name), ...(site.proxies[0]?.imports?.map((i) => i.name) || [])].join(', ') || 'none'}</span>
        <div className="row-actions" ref={menuContainerRef}>
          {canEdit && (
            <button type="button" className="row-menu-trigger" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Actions for ${addresses[0] || 'proxy'}`} onClick={(e) => { e.stopPropagation(); setMenuOpen((open) => !open); }}>
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
          )}
          {canEdit && menuOpen && (
            <div className="row-menu" role="menu">
              <button role="menuitem" type="button" className="row-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}><Pencil size={14} />Edit</button>
              <button role="menuitem" type="button" className="row-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onToggleDisabled(); }}><Power size={14} />{site.disabled ? 'Enable' : 'Disable'}</button>
              <button role="menuitem" type="button" className="row-menu-item danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(e); }}><Trash2 size={14} />Delete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
