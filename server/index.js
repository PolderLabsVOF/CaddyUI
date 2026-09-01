import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns/promises';
import {
  parseCaddyfile,
  appendSimpleProxy,
  updateSimpleProxy,
  appendSnippet,
  updateSnippet,
  deleteBlockAtLine,
  setProxyDisabled,
} from './caddyParser.js';
import { createStateStore } from './stateStore.js';
import { decryptAiApiKey, encryptAiApiKey } from './aiCrypto.js';
import { callAiProvider, validateAiBaseUrl } from './aiProviders.js';
import { runAiAssistant } from './aiAssistant.js';

const app = express();
app.disable('x-powered-by');

const PORT = Number(process.env.CADDY_UI_PORT || process.env.PORT || 8787);
const ROOT = process.cwd();
const APP_VERSION = JSON.parse(fssync.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
function defaultDataDir() {
  try {
    if (process.getuid && process.getuid() === 0) return '/var/lib/caddyui';
  } catch {}
  const home = os.homedir();
  return path.join(home || '.', '.local', 'share', 'caddyui', 'data');
}
const DATA_DIR = process.env.CADDY_UI_DATA_DIR || defaultDataDir();
const DB_PATH = process.env.CADDY_UI_DB_PATH || path.join(DATA_DIR, 'caddyui.db');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const SESSION_PATH = path.join(DATA_DIR, 'sessions.json');
const DEFAULT_SECRET = 'dev-change-me-caddy-ui';
const JWT_SECRET = process.env.CADDY_UI_SECRET || DEFAULT_SECRET;
const COOKIE_NAME = 'caddyui_token';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SETUP_TOKEN = process.env.CADDY_UI_SETUP_TOKEN || '';
const DEFAULT_CONFIG_MODE = 'api';
const DEFAULT_CADDY_API_URL = String(process.env.CADDY_UI_CADDY_API_URL || 'http://127.0.0.1:2019').trim();
const DEFAULT_CADDY_API_TOKEN = String(process.env.CADDY_UI_CADDY_API_TOKEN || '').trim();
const LOGIN_WINDOW_MS = Number(process.env.CADDY_UI_LOGIN_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Number(process.env.CADDY_UI_LOGIN_MAX_ATTEMPTS || 5);
const LOG_ROOTS = (process.env.CADDY_UI_LOG_ROOTS || ['/var/log/caddy', '/data/caddy/logs', '/config/log'].join(','))
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const ROLE_LEVEL = { view: 0, edit: 1, admin: 2 };
const VALID_ROLES = new Set(['view', 'edit', 'admin']);
const CONFIG_MODE_VALUES = new Set(['api']);
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
const MAX_PASSWORD_LENGTH = 72;
const ENV_ALLOWED_ORIGINS = (process.env.CADDY_UI_ALLOWED_ORIGINS || '')
  .split(',')
  .map((x) => normalizedOrigin(x.trim()))
  .filter(Boolean);
const ENV_ALLOW_REMOTE_SETUP = process.env.CADDY_UI_ALLOW_REMOTE_SETUP === '1';
const ENV_SECURE_COOKIE_MODE =
  process.env.CADDY_UI_INSECURE_COOKIE === '1'
    ? 'insecure'
    : process.env.CADDY_UI_SECURE_COOKIE === '1'
      ? 'secure'
      : 'auto';
const TRUST_PROXY_SETTING = String(process.env.CADDY_UI_TRUST_PROXY || '').trim().toLowerCase();
const ENV_TRUST_PROXY_HOPS =
  TRUST_PROXY_SETTING === '1' || TRUST_PROXY_SETTING === 'true'
    ? 1
    : /^\d+$/.test(TRUST_PROXY_SETTING) && Number(TRUST_PROXY_SETTING) > 0
      ? Number(TRUST_PROXY_SETTING)
      : 0;

const COMMON_CADDYFILES = [
  path.join(ROOT, 'Caddyfile'),
  '/etc/caddy/Caddyfile',
  '/config/Caddyfile',
  '/data/caddy/Caddyfile',
  '/srv/caddy/Caddyfile',
  '/usr/local/etc/caddy/Caddyfile',
];

const COMMON_LOGS = [
  process.env.CADDY_LOG_PATH,
  '/var/log/caddy/access.log',
  '/var/log/caddy/error.log',
  '/var/log/caddy/caddy.log',
  '/data/caddy/logs/access.log',
  '/config/log/caddy.log',
].filter(Boolean);
const UPDATE_CHANNELS = new Set(['stable', 'beta', 'dev']);
const UPDATE_BRANCH = {
  stable: 'main',
  beta: 'beta',
  dev: 'dev',
};
const JWT_ALGORITHM = 'HS256';
const COOKIE_MODE_VALUES = new Set(['auto', 'secure', 'insecure']);
let runtimeAllowedOrigins = new Set(ENV_ALLOWED_ORIGINS);
let runtimeAllowRemoteSetup = ENV_ALLOW_REMOTE_SETUP;
let runtimeSecureCookieMode = ENV_SECURE_COOKIE_MODE;
let runtimeTrustProxyHops = ENV_TRUST_PROXY_HOPS;
let runtimeTrustForwardHeaders = ENV_TRUST_PROXY_HOPS > 0;
const stateStore = createStateStore({
  dataDir: DATA_DIR,
  dbPath: DB_PATH,
  settingsPath: SETTINGS_PATH,
  sessionPath: SESSION_PATH,
  fileMode: 0o600,
});

const weakSecretConfigured = JWT_SECRET === DEFAULT_SECRET || JWT_SECRET.length < 32;
if (IS_PRODUCTION && weakSecretConfigured) {
  throw new Error('Set CADDY_UI_SECRET to a strong value (at least 32 characters).');
}
if (!IS_PRODUCTION && weakSecretConfigured) {
  console.warn('[security] Using a weak CADDY_UI_SECRET outside production; set at least 32 characters.');
}

app.set('trust proxy', runtimeTrustProxyHops > 0 ? runtimeTrustProxyHops : false);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!IS_PRODUCTION) return callback(null, true);
      return callback(null, runtimeAllowedOrigins.has(normalizedOrigin(origin)));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const loginAttempts = new Map();

function normalizedOrigin(origin) {
  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return '';
  }
}

function forwardedValue(req, headerName) {
  if (!runtimeTrustForwardHeaders) return '';
  const raw = req.headers[headerName];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value || '')
    .split(',')[0]
    .trim();
}

function requestProto(req) {
  const forwardedProto = forwardedValue(req, 'x-forwarded-proto').toLowerCase();
  if (forwardedProto === 'http' || forwardedProto === 'https') return forwardedProto;
  return req.secure ? 'https' : 'http';
}

function requestHost(req) {
  const host = forwardedValue(req, 'x-forwarded-host') || req.headers.host || '';
  return String(host).trim().toLowerCase();
}

function requestOrigin(req) {
  return normalizedOrigin(req.headers.origin || req.headers.referer || '');
}

function expectedOrigin(req) {
  const proto = requestProto(req);
  const host = requestHost(req);
  return host ? `${proto}://${host}`.toLowerCase() : '';
}

function originAllowed(req) {
  const origin = requestOrigin(req);
  if (!origin) return !IS_PRODUCTION;
  return (
    origin === expectedOrigin(req) ||
    runtimeAllowedOrigins.has(origin) ||
    (!IS_PRODUCTION && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
  );
}

function requireTrustedOrigin(req, res, next) {
  if (originAllowed(req)) return next();
  return res.status(403).json({ error: 'Origin not allowed.' });
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function privateIp(ip) {
  return (
    /^127\./.test(ip) ||
    ip === '::1' ||
    /^::ffff:127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    /^fc|^fd/i.test(ip)
  );
}

function requireSetupOrigin(req, res, next) {
  if (runtimeAllowRemoteSetup || !IS_PRODUCTION || privateIp(clientIp(req))) return next();
  return res.status(403).json({ error: 'Initial setup is blocked from public addresses.' });
}

function cookieOptions(req) {
  const secure = runtimeSecureCookieMode === 'insecure' ? false : runtimeSecureCookieMode === 'secure' || requestProto(req) === 'https';
  return { httpOnly: true, sameSite: 'strict', secure, path: '/' };
}

function tooManyAttempts(key) {
  const now = Date.now();
  pruneLoginAttempts(now);
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(key) {
  const now = Date.now();
  pruneLoginAttempts(now);
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearAttempts(key) {
  loginAttempts.delete(key);
}

function pruneLoginAttempts(now = Date.now()) {
  if (loginAttempts.size < 500) return;
  for (const [key, value] of loginAttempts.entries()) {
    if (!value?.resetAt || value.resetAt <= now) loginAttempts.delete(key);
  }
}

function requireRateLimit(namespace, maxAttempts, windowMs = LOGIN_WINDOW_MS) {
  return (req, res, next) => {
    const key = `${namespace}:${clientIp(req)}:${req.user?.username || 'anon'}`;
    const now = Date.now();
    pruneLoginAttempts(now);
    const entry = loginAttempts.get(key);
    if (!entry || now > entry.resetAt) {
      loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxAttempts) {
      return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
    }
    entry.count += 1;
    return next();
  };
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeUser(user, fallbackRole = 'view') {
  if (!user) return null;
  return {
    username: String(user.username || '').trim(),
    passwordHash: user.passwordHash || '',
    role: user.role || fallbackRole,
  };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeCookieMode(value, fallback = 'auto') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return COOKIE_MODE_VALUES.has(normalized) ? normalized : fallback;
}

function normalizeAllowedOrigins(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [...new Set(values.map((item) => normalizedOrigin(String(item || '').trim())).filter(Boolean))];
}

function normalizeTrustProxyHops(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const hops = Math.floor(numeric);
  return hops > 0 ? hops : 0;
}

function normalizeConfigMode(value, fallback = DEFAULT_CONFIG_MODE) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return CONFIG_MODE_VALUES.has(normalized) ? normalized : fallback;
}

function normalizeProxyDescription(value = '') {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .trim()
    .slice(0, 280);
}

function normalizeApiUrl(value, fallback = '') {
  const normalized = String(value ?? fallback ?? '').trim();
  if (!normalized) return '';
  return normalized.replace(/\/+$/, '');
}

function applyRuntimeSecurity(settings) {
  runtimeAllowedOrigins = new Set(normalizeAllowedOrigins(settings.allowedOrigins));
  runtimeAllowRemoteSetup = normalizeBoolean(settings.allowRemoteSetup, ENV_ALLOW_REMOTE_SETUP);
  runtimeSecureCookieMode = normalizeCookieMode(settings.secureCookieMode, ENV_SECURE_COOKIE_MODE);
  runtimeTrustProxyHops = normalizeTrustProxyHops(settings.trustProxyHops, ENV_TRUST_PROXY_HOPS);
  runtimeTrustForwardHeaders = runtimeTrustProxyHops > 0;
  app.set('trust proxy', runtimeTrustProxyHops > 0 ? runtimeTrustProxyHops : false);
}

function normalizeSettings(settings) {
  const base = settings && typeof settings === 'object' ? settings : {};
  const users = Array.isArray(base.users)
    ? base.users
        .map((user) => normalizeUser(user, 'view'))
        .filter((user) => user && user.username)
    : base.user
      ? [normalizeUser(base.user, 'admin')]
      : [];
  return {
    configured: Boolean(base.configured),
    configMode: normalizeConfigMode(base.configMode, DEFAULT_CONFIG_MODE),
    caddyfilePath: base.caddyfilePath || '',
    caddyApiUrl: normalizeApiUrl(base.caddyApiUrl, DEFAULT_CADDY_API_URL),
    caddyApiToken: String(base.caddyApiToken ?? DEFAULT_CADDY_API_TOKEN).trim(),
    aiEnabled: Boolean(base.aiEnabled),
    aiProvider: base.aiProvider === 'anthropic' ? 'anthropic' : 'openai',
    aiBaseUrl: String(base.aiBaseUrl || '').trim(),
    aiModel: String(base.aiModel || '').trim(),
    aiAllowPrivateBaseUrl: Boolean(base.aiAllowPrivateBaseUrl),
    aiApiKeyEncrypted:
      base.aiApiKeyEncrypted && typeof base.aiApiKeyEncrypted === 'object' && base.aiApiKeyEncrypted.version === 1
        ? base.aiApiKeyEncrypted
        : null,
    logPaths: Array.isArray(base.logPaths) ? base.logPaths : COMMON_LOGS,
    updateChannel: UPDATE_CHANNELS.has(base.updateChannel) ? base.updateChannel : 'stable',
    trustProxyHops: normalizeTrustProxyHops(base.trustProxyHops, ENV_TRUST_PROXY_HOPS),
    allowRemoteSetup: normalizeBoolean(base.allowRemoteSetup, ENV_ALLOW_REMOTE_SETUP),
    secureCookieMode: normalizeCookieMode(base.secureCookieMode, ENV_SECURE_COOKIE_MODE),
    allowedOrigins: normalizeAllowedOrigins(base.allowedOrigins ?? ENV_ALLOWED_ORIGINS),
    users,
  };
}

function caddyConfigured(settings) {
  const normalized = normalizeSettings(settings);
  if (normalized.configMode === 'api') return Boolean(normalized.caddyApiUrl);
  return Boolean(normalized.caddyfilePath);
}

function currentUserRecord(settings, username) {
  const normalized = normalizeSettings(settings);
  return normalized.users.find((user) => user.username === username) || null;
}

function exposeUser(user) {
  return user ? { username: user.username, role: user.role } : null;
}

function hasPermission(role, required) {
  return (ROLE_LEVEL[role] ?? -1) >= (ROLE_LEVEL[required] ?? 99);
}

function requirePermission(required) {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user.role, required)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

function summarizeText(value = '', max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function eventActor(req, fallbackUsername = '', fallbackRole = '') {
  return {
    username: String(req?.user?.username || fallbackUsername || 'system').trim() || 'system',
    role: String(req?.user?.role || fallbackRole || '').trim() || 'system',
  };
}

async function recordEvent(req, {
  actorUsername = '',
  actorRole = '',
  kind = 'app',
  action = 'action',
  targetType = '',
  targetId = '',
  status = 'success',
  message = '',
  details = {},
} = {}) {
  const actor = eventActor(req, actorUsername, actorRole);
  const event = {
    id: randomUUID(),
    createdAt: Date.now(),
    actorUsername: actor.username,
    actorRole: actor.role,
    kind: String(kind || 'app').trim(),
    action: String(action || 'action').trim(),
    targetType: String(targetType || '').trim(),
    targetId: String(targetId || '').trim(),
    status: String(status || 'success').trim(),
    message: summarizeText(message || `${action} ${targetType}`),
    details: details && typeof details === 'object' ? details : {},
  };
  const store = await stateStore;
  await store.appendEvent(event);
  void store.pruneEvents(2000).catch(() => {});
  return event;
}

function normalizeDomainScope(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^\*?\.?/, '');
}

function normalizeCategoryScope(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeDomainScopes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeDomainScope(value)).filter(Boolean))];
}

function normalizeCategoryScopes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeCategoryScope(value)).filter(Boolean))];
}

function userHasScopedEditRestrictions(user) {
  if (!user || user.role !== 'edit') return false;
  const domains = normalizeDomainScopes(user.allowedDomains || []);
  const categories = normalizeCategoryScopes(user.allowedCategories || []);
  return domains.length > 0 || categories.length > 0;
}

function domainScopeMatches(host = '', scope = '') {
  const normalizedHost = normalizeDomainScope(host);
  const normalizedScope = normalizeDomainScope(scope);
  if (!normalizedHost || !normalizedScope) return false;
  if (normalizedScope.startsWith('*.')) {
    const base = normalizedScope.slice(2);
    return normalizedHost.endsWith(`.${base}`);
  }
  return normalizedHost === normalizedScope;
}

function canUserEditProxyTarget(user, { host = '', category = '' } = {}) {
  if (!user || user.role === 'admin' || !hasPermission(user.role, 'edit')) return true;
  if (!userHasScopedEditRestrictions(user)) return true;
  const allowedDomains = normalizeDomainScopes(user.allowedDomains || []);
  const allowedCategories = normalizeCategoryScopes(user.allowedCategories || []);
  const normalizedHost = normalizeDomainScope(host);
  const normalizedCategory = normalizeCategoryScope(category);
  const domainAllowed = !allowedDomains.length || (normalizedHost && allowedDomains.some((scope) => domainScopeMatches(normalizedHost, scope)));
  const categoryAllowed = !allowedCategories.length || (normalizedCategory && allowedCategories.includes(normalizedCategory));
  return domainAllowed && categoryAllowed;
}

function visibleAiProxySummaries(parsed, user) {
  return (parsed?.sites || [])
    .filter((site) => {
      if (!userHasScopedEditRestrictions(user)) return true;
      return canUserEditProxyTarget(user, { host: site.addresses?.[0] || '', category: site.category || '' });
    })
    .map((site) => ({
      line: Number(site.line),
      host: String(site.addresses?.[0] || ''),
      upstream: String(site.proxies?.[0]?.upstreams?.[0] || site.proxies?.[0]?.upstream || ''),
      imports: Array.isArray(site.imports) ? site.imports : [],
      category: site.category || '',
      tags: Array.isArray(site.tags) ? site.tags : [],
      description: site.description || '',
      disabled: Boolean(site.disabled),
    }))
    .slice(0, 300);
}

function detectIndentUnit(source = '') {
  const text = String(source || '');
  const tabLines = text.match(/^\t+/gm) || [];
  const spaceLines = text.match(/^ +/gm) || [];
  if (tabLines.length && (!spaceLines.length || tabLines.length >= spaceLines.length)) {
    return { indent: 'tab', width: 1 };
  }
  if (spaceLines.length) {
    // Use the smallest non-zero indent as the base unit so we don't report
    // nested-block indentation (e.g. inside a reverse_proxy).
    const widths = spaceLines.map((m) => m.length).sort((a, b) => a - b);
    const smallest = widths[0];
    // Pick the largest candidate that divides the smallest indent so we report
    // an indent unit the user actually uses at the top level.
    for (const candidate of [8, 4, 2]) {
      if (smallest % candidate === 0) {
        return { indent: 'spaces', width: candidate };
      }
    }
    return { indent: 'spaces', width: smallest };
  }
  return { indent: 'tab', width: 1 };
}

function detectQuoteStyle(source = '') {
  const text = String(source || '');
  const doubleQuotes = (text.match(/"/g) || []).length;
  const singleQuotes = (text.match(/'/g) || []).length;
  if (doubleQuotes > singleQuotes) return 'double';
  if (singleQuotes > doubleQuotes) return 'single';
  return 'double';
}

function detectNamingConvention(samples = []) {
  const hosts = samples.filter(Boolean).map((host) => String(host).trim());
  if (!hosts.length) return 'unknown';
  const subdomains = hosts.filter((h) => h.includes('.'));
  const hasHyphens = subdomains.some((h) => /-/.test(h.split('.')[0]));
  const hasUnderscores = hosts.some((h) => /_/.test(h));
  const allLower = hosts.every((h) => h === h.toLowerCase());
  const allDigits = hosts.every((h) => /^[a-z0-9.-]+$/.test(h));
  return {
    hyphenated: hasHyphens,
    underscored: hasUnderscores,
    allLowercase: allLower,
    onlySafeChars: allDigits,
    exampleHosts: hosts.slice(0, 5),
  };
}

function detectLineEndings(source = '') {
  return /\r\n/.test(String(source || '')) ? 'crlf' : 'lf';
}

function extractSampleBlocks(parsed, content, max = 4, maxBlockChars = 600) {
  const lines = String(content || '').split(/\r?\n/);
  const samples = [];
  for (const site of parsed?.sites || []) {
    if (samples.length >= max) break;
    const start = Number(site.line) - 1;
    const end = Math.min(lines.length, Number(site.endLine || site.line));
    if (start < 0 || end <= start) continue;
    const block = lines.slice(start, end).join('\n');
    samples.push({
      host: site.addresses?.[0] || '',
      line: site.line,
      block: block.length > maxBlockChars ? `${block.slice(0, maxBlockChars)}…` : block,
    });
  }
  return samples;
}

function summarizeSnippets(parsed) {
  return (parsed?.snippets || []).map((snippet) => ({
    name: snippet.name,
    line: snippet.line,
    usedBy: Array.isArray(snippet.usedBy) ? snippet.usedBy : [],
    inferredType: snippet.inferredType || 'snippet',
    body: snippet.body || '',
  }));
}

function detectSnippetUsage(parsed) {
  const names = (parsed?.snippets || []).map((s) => s.name);
  const imported = new Set();
  for (const site of parsed?.sites || []) {
    for (const imp of site.imports || []) imported.add(imp.name || imp);
  }
  const declared = new Set(names);
  return {
    declared: [...declared],
    referenced: [...imported].filter((name) => declared.has(name)),
    orphan: [...declared].filter((name) => !imported.has(name)),
  };
}

async function aiContextForUser(user) {
  const { settings, content } = await readWorkingConfig();
  const parsed = await parseConfigWithMeta(content);
  const proxies = visibleAiProxySummaries(parsed, user);
  const indent = detectIndentUnit(content);
  const quoteStyle = detectQuoteStyle(content);
  const lineEndings = detectLineEndings(content);
  const naming = detectNamingConvention(proxies.map((p) => p.host));
  const sampleBlocks = extractSampleBlocks(parsed, content, 4, 600);
  const snippets = summarizeSnippets(parsed);
  const snippetUsage = detectSnippetUsage(parsed);
  return {
    configContent: content,
    proxies,
    status: {
      configMode: settings.configMode,
      proxyCount: proxies.length,
      snippetCount: snippets.length,
      caddyApiUrlConfigured: Boolean(settings.caddyApiUrl),
    },
    formatGuide: {
      indent: indent.indent,
      indentWidth: indent.width,
      quoteStyle,
      lineEndings,
      naming,
    },
    sampleBlocks,
    snippets,
    snippetUsage,
  };
}

function aiProviderConfig(settings) {
  return {
    provider: settings.aiProvider,
    baseUrl: settings.aiBaseUrl,
    model: settings.aiModel,
    enabled: settings.aiEnabled,
    configured: Boolean(settings.aiEnabled && settings.aiBaseUrl && settings.aiModel && settings.aiApiKeyEncrypted),
  };
}

function setupTokenRequired(settings) {
  return IS_PRODUCTION && normalizeSettings(settings).users.length === 0 && Boolean(SETUP_TOKEN);
}

function validUsername(username) {
  return USERNAME_PATTERN.test(String(username || '').trim());
}

function validPassword(password) {
  const value = String(password || '');
  return value.length >= 8 && value.length <= MAX_PASSWORD_LENGTH;
}

function adminCount(settings) {
  return normalizeSettings(settings).users.filter((user) => user.role === 'admin').length;
}

async function loadSettings() {
  const store = await stateStore;
  const raw = await store.getJson('settings', null);
  const normalized = raw
    ? normalizeSettings(raw)
    : normalizeSettings({ configured: false, configMode: DEFAULT_CONFIG_MODE, caddyfilePath: '', caddyApiUrl: DEFAULT_CADDY_API_URL, logPaths: COMMON_LOGS, users: [] });
  applyRuntimeSecurity(normalized);
  return normalized;
}

async function saveSettings(settings) {
  const store = await stateStore;
  const normalized = normalizeSettings(settings);
  applyRuntimeSecurity(normalized);
  await store.setJson('settings', normalized);
}

function publicSettings(settings, currentUsername = '') {
  const normalized = normalizeSettings(settings);
  const currentUser = currentUserRecord(normalized, currentUsername);
  return {
    userConfigured: normalized.users.length > 0,
    caddyConfigured: Boolean(normalized.configured && caddyConfigured(normalized)),
    configured: Boolean(normalized.configured && normalized.users.length > 0 && caddyConfigured(normalized)),
    configMode: normalized.configMode,
    caddyfilePath: normalized.caddyfilePath || '',
    caddyApiUrl: normalized.caddyApiUrl || '',
    hasCaddyApiToken: Boolean(normalized.caddyApiToken),
    hasCaddyApiSecret: Boolean(normalized.caddyApiToken),
    aiEnabled: Boolean(normalized.aiEnabled),
    aiProvider: normalized.aiProvider,
    aiBaseUrl: normalized.aiBaseUrl || '',
    aiModel: normalized.aiModel || '',
    aiAllowPrivateBaseUrl: Boolean(normalized.aiAllowPrivateBaseUrl),
    hasAiApiKey: Boolean(normalized.aiApiKeyEncrypted),
    logPaths: normalized.logPaths || COMMON_LOGS,
    updateChannel: normalized.updateChannel || 'stable',
    trustProxyHops: normalized.trustProxyHops ?? 0,
    allowRemoteSetup: Boolean(normalized.allowRemoteSetup),
    secureCookieMode: normalized.secureCookieMode || 'auto',
    allowedOrigins: normalized.allowedOrigins || [],
    username: currentUser?.username || '',
    role: currentUser?.role || '',
  };
}

function statusSettings(settings, authenticated, currentUsername = '') {
  const normalized = normalizeSettings(settings);
  const currentUser = currentUserRecord(normalized, currentUsername);
  const base = {
    userConfigured: normalized.users.length > 0,
    caddyConfigured: Boolean(normalized.configured && caddyConfigured(normalized)),
    configured: Boolean(normalized.configured && normalized.users.length > 0 && caddyConfigured(normalized)),
    setupTokenRequired: setupTokenRequired(normalized),
    username: authenticated ? currentUser?.username || '' : '',
    role: authenticated ? currentUser?.role || '' : '',
  };
  if (!authenticated) return { ...base, caddyfilePath: '', caddyApiUrl: '', configMode: DEFAULT_CONFIG_MODE, logPaths: [] };
  return {
    ...base,
    configMode: normalized.configMode,
    caddyfilePath: normalized.caddyfilePath || '',
    caddyApiUrl: normalized.caddyApiUrl || '',
    hasCaddyApiToken: Boolean(normalized.caddyApiToken),
    hasCaddyApiSecret: Boolean(normalized.caddyApiToken),
    aiEnabled: Boolean(normalized.aiEnabled),
    aiProvider: normalized.aiProvider,
    aiBaseUrl: normalized.aiBaseUrl || '',
    aiModel: normalized.aiModel || '',
    aiAllowPrivateBaseUrl: Boolean(normalized.aiAllowPrivateBaseUrl),
    hasAiApiKey: Boolean(normalized.aiApiKeyEncrypted),
    logPaths: normalized.logPaths || COMMON_LOGS,
    updateChannel: normalized.updateChannel || 'stable',
    trustProxyHops: normalized.trustProxyHops ?? 0,
    allowRemoteSetup: Boolean(normalized.allowRemoteSetup),
    secureCookieMode: normalized.secureCookieMode || 'auto',
    allowedOrigins: normalized.allowedOrigins || [],
  };
}

function updateTargetFromSettings(settings, currentBranch = 'unknown') {
  const normalized = normalizeSettings(settings);
  const channel = normalized.updateChannel || 'stable';
  if (UPDATE_CHANNELS.has(channel)) {
    return { channel, branch: UPDATE_BRANCH[channel] };
  }
  if (currentBranch === 'dev' || currentBranch === 'beta') {
    return { channel: currentBranch, branch: currentBranch };
  }
  return { channel: 'stable', branch: UPDATE_BRANCH.stable };
}

function updateTargetForChannel(channel, fallbackBranch = 'unknown') {
  const normalized = String(channel || '').trim().toLowerCase();
  if (UPDATE_CHANNELS.has(normalized)) {
    return { channel: normalized, branch: UPDATE_BRANCH[normalized] };
  }
  return updateTargetFromSettings({ updateChannel: normalized }, fallbackBranch);
}

async function loadSessionState() {
  const store = await stateStore;
  return (await store.getJson('sessions', { revoked: {} })) || { revoked: {} };
}

async function saveSessionState(state) {
  const store = await stateStore;
  await store.setJson('sessions', state);
}

function pruneRevoked(state) {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of Object.entries(state.revoked || {})) {
    if (!exp || exp <= now) delete state.revoked[jti];
  }
  return state;
}

async function tokenRevoked(jti) {
  if (!jti) return false;
  const state = pruneRevoked(await loadSessionState());
  return Boolean(state.revoked?.[jti]);
}

async function revokeToken(decoded) {
  if (!decoded?.jti || !decoded?.exp) return;
  const state = pruneRevoked(await loadSessionState());
  state.revoked[decoded.jti] = decoded.exp;
  await saveSessionState(state);
}

function sign(username) {
  return jwt.sign({ username, jti: randomUUID() }, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: '4h' });
}

async function auth(req, res, next) {
  const token = req.cookies[COOKIE_NAME] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    if (await tokenRevoked(decoded.jti)) return res.status(401).json({ error: 'Session expired' });
    const settings = await loadSettings();
    const user = currentUserRecord(settings, decoded.username);
    if (!user) return res.status(401).json({ error: 'Session expired' });
    req.user = exposeUser(user);
    req.userToken = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

function authenticatedUser(req) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  } catch {
    return null;
  }
}

// Module-level hook so tests can swap in a stub `run` without monkey-patching
// `node:child_process`. See `setRunForTests` below.
let __runForTestsImpl = null;
function run(command, args, options = {}) {
  if (__runForTestsImpl) return __runForTestsImpl(command, args, options);
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => resolve({ ok: false, code: -1, stdout, stderr: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

function setRunForTests(impl) {
  __runForTestsImpl = typeof impl === 'function' ? impl : null;
}

async function scanExistingFiles(candidates) {
  const found = [];
  for (const candidate of [...new Set(candidates)].filter(Boolean)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) found.push({ path: candidate, size: stat.size, modified: stat.mtimeMs });
    } catch {}
  }
  return found;
}

async function scanCaddyfiles() {
  return scanExistingFiles(COMMON_CADDYFILES);
}

async function scanLogRoot(root, depth = 0) {
  if (depth > 4) return [];
  const entries = [];
  try {
    const base = await fs.realpath(root);
    for (const item of await fs.readdir(base, { withFileTypes: true })) {
      const nextPath = path.join(base, item.name);
      if (item.isDirectory()) entries.push(...(await scanLogRoot(nextPath, depth + 1)));
      if (item.isFile() && /(caddy|access|error|log)/i.test(item.name)) entries.push(nextPath);
    }
  } catch {}
  return entries;
}

async function scanLogfiles(settings = {}) {
  const discovered = [];
  for (const root of LOG_ROOTS) discovered.push(...(await scanLogRoot(root)));
  return scanExistingFiles([...(settings.logPaths || []), ...COMMON_LOGS, ...discovered]);
}

async function allowedLogPath(filePath) {
  try {
    const resolved = await fs.realpath(filePath);
    for (const root of LOG_ROOTS) {
      try {
        const base = await fs.realpath(root);
        if (resolved === base || resolved.startsWith(`${base}${path.sep}`)) return true;
      } catch {}
    }
  } catch {}
  return false;
}

async function saveWorkingConfig(content = '') {
  const store = await stateStore;
  await store.setJson('working_config', {
    content: String(content || ''),
    updatedAt: new Date().toISOString(),
  });
}

async function readWorkingConfig() {
  const settings = await loadSettings();
  const store = await stateStore;
  const cached = await store.getJson('working_config', null);
  if (typeof cached?.content === 'string') {
    return { settings, content: cached.content, path: 'caddy://admin-api' };
  }
  return { settings, content: '', path: 'caddy://admin-api' };
}

function caddyApiAuthorizationValue(token = '') {
  const value = String(token || '').trim();
  if (!value) return '';
  if (/^bearer\s+/i.test(value) || /^basic\s+/i.test(value)) return value;
  return `Bearer ${value}`;
}

async function requestCaddyApi(settings, endpoint, options = {}) {
  const normalized = normalizeSettings(settings);
  const base = normalizeApiUrl(normalized.caddyApiUrl, DEFAULT_CADDY_API_URL);
  if (!base) throw new Error('Caddy API URL is not configured.');
  const url = `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const headers = { ...(options.headers || {}) };
  try {
    if (!headers.Origin) headers.Origin = new URL(base).origin;
  } catch {}
  const authValue = caddyApiAuthorizationValue(normalized.caddyApiToken);
  if (authValue) headers.Authorization = authValue;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs || 6000),
  });
  return response;
}

async function testCaddyApiConnection(settingsLike = {}, overrides = {}) {
  const settings = normalizeSettings({
    ...settingsLike,
    configMode: 'api',
    caddyApiUrl: overrides.caddyApiUrl === undefined ? settingsLike.caddyApiUrl : overrides.caddyApiUrl,
    caddyApiToken: overrides.caddyApiToken === undefined ? settingsLike.caddyApiToken : overrides.caddyApiToken,
  });
  const response = await requestCaddyApi(settings, '/config/', { method: 'GET', timeoutMs: 6000 });
  const result = await caddyResponseData(response);
  return {
    ok: result.ok,
    status: result.status,
    message: result.ok ? 'Connected to Caddy Admin API.' : result.raw || `Caddy API request failed (${result.status}).`,
    value: result.data,
  };
}

async function loadResetConfigTemplate() {
  const templatePath = path.join(ROOT, 'Caddyfile.example');
  try {
    return await fs.readFile(templatePath, 'utf8');
  } catch {
    return 'localhost {\n\trespond "Caddy reset placeholder" 200\n}\n';
  }
}

function caddyPathPart(value = '') {
  if (Array.isArray(value)) return value.filter(Boolean).join('/');
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function caddyEndpoint(scope, path = '') {
  const cleaned = caddyPathPart(path);
  return cleaned ? `${scope}/${cleaned}` : `${scope}/`;
}

function caddyPayload(value) {
  if (value === undefined) return undefined;
  return JSON.stringify(value);
}

function caddyMutationBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    if (Object.prototype.hasOwnProperty.call(req.body, 'value')) return req.body.value;
    if (Object.prototype.hasOwnProperty.call(req.body, 'ifMatch')) {
      const payload = { ...req.body };
      delete payload.ifMatch;
      if (Object.keys(payload).length === 0) return undefined;
      return payload;
    }
    return req.body;
  }
  return req.body;
}

function caddyIfMatch(req) {
  const header = String(req.get('if-match') || '').trim();
  if (header) return header;
  return String(req.body?.ifMatch || '').trim();
}

async function caddyResponseData(response) {
  const text = await response.text();
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const etag = response.headers.get('etag') || '';
  let data = text;
  if (contentType.includes('application/json')) {
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
  }
  return { status: response.status, ok: response.ok, etag, contentType, raw: text, data };
}

async function applyConfigContent(settings, content, { backup = false } = {}) {
  const normalized = normalizeSettings(settings);
  const configContent = String(content || '');
  const response = await requestCaddyApi(normalized, '/load', {
    method: 'POST',
    headers: { 'Content-Type': 'text/caddyfile' },
    body: configContent,
    timeoutMs: 12000,
  });
  if (!response.ok) {
    const message = (await response.text()) || `Caddy API load failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  await saveWorkingConfig(configContent);
  return { backup: '' };
}

async function tailFile(filePath, lines = 200) {
  const content = await fs.readFile(filePath, 'utf8');
  return content.split('\n').slice(-lines).join('\n');
}

function splitHostPort(value = '') {
  const clean = String(value).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const [host, port] = clean.split(':');
  return { host, port: Number(port || 80) };
}

function tcpCheck(host, port, timeout = 1800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (online, error = '') => {
      socket.destroy();
      resolve({ online, error });
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err.code || err.message));
  });
}

// probeTarget runs TCP reachability checks against hosts already present in
// the user's Caddyfile. Only `edit` users can mutate that file via
// POST /api/proxies/:line and friends. `view` users never reach this path
// (gated by `requirePermission('view')` on /api/proxies/health and on
// /api/config?health=1). The previous `privateIp` guard produced false
// negatives on every install whose upstream is a Docker bridge or LAN host
// — exactly the canonical CaddyUI use case — without preventing any real
// SSRF, because Caddy itself is already configured to talk to those
// upstreams. The TCP probe is observability only.
async function probeTarget(host = '', port = 0) {
  const value = String(host || '').trim();
  if (!value) return { online: false, error: 'missing', host: '', port };
  const ipVersion = net.isIP(value);
  if (ipVersion > 0) {
    const direct = await tcpCheck(value, port);
    return { ...direct, host: value, port };
  }
  try {
    const resolved = await dns.lookup(value);
    const resolvedAddress = String(resolved.address || '');
    if (!resolvedAddress) return { online: false, error: 'lookup_failed', host: value, port };
    // Connect to the already-validated IP to avoid a second DNS resolution step.
    const direct = await tcpCheck(resolvedAddress, port);
    return { ...direct, host: value, port };
  } catch (error) {
    return { online: false, error: error.code || error.message || 'lookup_failed', host: value, port };
  }
}

async function checkProxyHealth(parsed) {
  const results = {};
  await Promise.all(
    (parsed.sites || []).map(async (site) => {
      if (site.disabled) {
        results[site.id] = {
          local: { online: false, error: 'disabled', disabled: true, host: '', port: 0 },
        };
        return;
      }
      const upstream = site.proxies?.[0]?.upstreams?.[0] || '';
      const target = splitHostPort(upstream);
      const local = await probeTarget(target.host, target.port);
      results[site.id] = {
        local,
      };
    })
  );
  return results;
}

async function collectLogs(settings, lines = 200) {
  async function collectJournalLogs(maxLines) {
    if (!fssync.existsSync('/run/systemd/system')) return null;
    const result = await run('journalctl', ['-u', 'caddy', '-n', String(maxLines), '--no-pager', '-o', 'short-iso']);
    if (!result.ok) return null;
    return { source: 'journalctl:caddy', content: result.stdout || '', ok: true };
  }

  const mode = String(settings?.logMode || 'all');
  const discovered = await scanLogfiles(settings);
  const candidatePaths = [...new Set([...(settings.logPaths || []), ...COMMON_LOGS, ...discovered.map((x) => x.path)])];
  const paths = [];
  for (const candidate of candidatePaths) {
    if (await allowedLogPath(candidate)) paths.push(candidate);
  }

  const entries = [];
  if (mode !== 'journal') {
    for (const logPath of paths) {
      try {
        const stat = await fs.stat(logPath);
        if (stat.isFile()) {
          entries.push({ source: logPath, content: await tailFile(logPath, lines), ok: true });
        }
      } catch {}
    }
  }
  if (mode !== 'files') {
    const journalEntry = await collectJournalLogs(lines);
    if (journalEntry) entries.push(journalEntry);
  }

  if (entries.length === 0) {
    entries.push({
      source: 'not-found',
      ok: false,
      content: 'No Caddy log files found. Configure a log path in Settings or mount Caddy logs into this container.',
    });
  }
  return entries;
}

async function validateConfig(content) {
  const tmp = path.join(os.tmpdir(), `caddyui-${process.pid}-${Date.now()}-${randomUUID()}.Caddyfile`);
  await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  let result;
  try {
    result = await run('caddy', ['validate', '--config', tmp, '--adapter', 'caddyfile']);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  if (result.code === -1) {
    return {
      ok: false,
      unavailable: true,
      stdout: result.stdout,
      stderr: 'Caddy binary is not available in this container. Install/mount caddy or disable validation for development.',
    };
  }
  return result;
}

async function formatConfig(content) {
  const input = String(content || '');
  const tmp = path.join(os.tmpdir(), `caddyui-fmt-${process.pid}-${Date.now()}-${randomUUID()}.Caddyfile`);
  await fs.writeFile(tmp, input, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  let result;
  let formatted = input;
  try {
    result = await run('caddy', ['fmt', '--overwrite', tmp]);
    try {
      formatted = await fs.readFile(tmp, 'utf8');
    } catch {}
  } finally {
    await fs.rm(tmp, { force: true });
  }
  if (result.code === -1) {
    return {
      ok: false,
      unavailable: true,
      code: -1,
      stdout: result.stdout,
      stderr: 'Caddy binary is not available in this container. Install/mount caddy to run caddy fmt.',
      content: input,
      changed: false,
    };
  }
  return {
    ok: result.ok,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    content: formatted,
    changed: formatted !== input,
  };
}

async function validateConfigForSettings(settings, content) {
  const normalized = normalizeSettings(settings);
  try {
    const response = await requestCaddyApi(normalized, '/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'text/caddyfile' },
      body: String(content || ''),
      timeoutMs: 12000,
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        code: response.status,
        stdout: '',
        stderr: body || `Caddy API adapt failed (${response.status}).`,
      };
    }
    return { ok: true, code: 0, stdout: body, stderr: '' };
  } catch (error) {
    return {
      ok: false,
      unavailable: true,
      code: -1,
      stdout: '',
      stderr: error.message || 'Caddy API is unavailable.',
    };
  }
}


async function parseConfigCached(content) {
  const hash = createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
  const store = await stateStore;
  const cached = await store.getParsed(hash);
  if (cached) return cached;
  const parsed = parseCaddyfile(content);
  await store.setParsed(hash, parsed);
  if (Math.random() < 0.05) await store.pruneParsed(300);
  return parsed;
}

function normalizeProxyTags(tags = []) {
  const values = Array.isArray(tags)
    ? tags
    : String(tags || '')
        .split(',')
        .map((x) => x.trim());
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const tag = String(value || '').trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

function normalizeProxyCategory(value = '') {
  return String(value || '')
    .split(',')[0]
    .trim();
}

function proxyMetaKeyFromParts(host = '', upstream = '') {
  const normalizedHost = String(host || '').trim().toLowerCase();
  const normalizedUpstream = String(upstream || '').trim();
  return normalizedHost && normalizedUpstream ? `${normalizedHost}|${normalizedUpstream}` : '';
}

function proxyMetaKeyFromSite(site) {
  const host = site?.addresses?.[0] || '';
  const upstream = site?.proxies?.[0]?.upstreams?.[0] || '';
  return proxyMetaKeyFromParts(host, upstream);
}

function mergeProxyMeta(parsed, metaMap = {}) {
  if (!parsed?.sites?.length) return parsed;
  const sites = parsed.sites.map((site) => {
    const key = proxyMetaKeyFromSite(site);
    const meta = key ? metaMap[key] : null;
    return {
      ...site,
      tags: normalizeProxyTags(meta?.tags?.length ? meta.tags : site.tags || []),
      category: normalizeProxyCategory(meta?.category || site.category || ''),
      description: normalizeProxyDescription(meta?.description || site.description || ''),
    };
  });
  return { ...parsed, sites };
}

async function parseConfigWithMeta(content) {
  const parsed = await parseConfigCached(content);
  const store = await stateStore;
  const metaMap = await store.getProxyMetaMap();
  const migrations = [];
  for (const site of parsed?.sites || []) {
    const key = proxyMetaKeyFromSite(site);
    if (!key || metaMap[key]) continue;
    const tags = normalizeProxyTags(site.tags || []);
    const category = normalizeProxyCategory(site.category || '');
    const description = normalizeProxyDescription(site.description || '');
    if (!tags.length && !category && !description) continue;
    migrations.push({ key, tags, category, description });
  }
  if (migrations.length) {
    for (const entry of migrations) {
      await store.setProxyMeta(entry.key, entry.tags, entry.category, entry.description);
      metaMap[entry.key] = { tags: entry.tags, category: entry.category, description: entry.description };
    }
  }
  const merged = mergeProxyMeta(parsed, metaMap);
  return merged;
}

async function pruneProxyMetaForParsed(parsed) {
  const store = await stateStore;
  const keys = (parsed?.sites || []).map(proxyMetaKeyFromSite).filter(Boolean);
  await store.pruneProxyMeta(keys);
}

async function saveProxyMetaByParts(host, upstream, tags = [], category = '', description = '') {
  const store = await stateStore;
  const key = proxyMetaKeyFromParts(host, upstream);
  if (!key) return;
  const normalizedTags = normalizeProxyTags(tags);
  const normalizedCategory = normalizeProxyCategory(category);
  const normalizedDescription = normalizeProxyDescription(description);
  if (!normalizedTags.length && !normalizedCategory && !normalizedDescription) {
    await store.deleteProxyMeta(key);
    return;
  }
  await store.setProxyMeta(key, normalizedTags, normalizedCategory, normalizedDescription);
}

async function saveProxyMetaForSite(site, tags = [], category = '', description = '') {
  const host = site?.addresses?.[0] || '';
  const upstream = site?.proxies?.[0]?.upstreams?.[0] || '';
  await saveProxyMetaByParts(host, upstream, tags, category, description);
}

async function deleteProxyMetaForSite(site) {
  const store = await stateStore;
  const key = proxyMetaKeyFromSite(site);
  if (!key) return;
  await store.deleteProxyMeta(key);
}

async function appBranch() {
  const result = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT });
  return result.ok ? result.stdout.trim() : 'unknown';
}

const APP_UPDATE_FETCH_TTL_MS = 5 * 60 * 1000;
let lastAppUpdateFetchAt = 0;
let lastAppUpdateFetchKey = '';

async function appUpdateStatus(fetchMode = false, channelOverride = '') {
  const currentBranch = await appBranch();
  const settings = await loadSettings();
  const overrideLc = String(channelOverride || '').trim().toLowerCase();
  const { channel, branch: targetBranch } = UPDATE_CHANNELS.has(overrideLc)
    ? updateTargetForChannel(overrideLc, currentBranch)
    : updateTargetFromSettings(settings, currentBranch);
  const key = `${channel}:${targetBranch}`;
  let fetchError = null;
  const wantsFetch = fetchMode === true
    || (fetchMode === 'auto'
        && targetBranch !== 'unknown'
        && (lastAppUpdateFetchKey !== key || Date.now() - lastAppUpdateFetchAt > APP_UPDATE_FETCH_TTL_MS));
  if (wantsFetch) {
    const r = await run('git', ['fetch', '--quiet', 'origin', targetBranch], { cwd: ROOT });
    lastAppUpdateFetchAt = Date.now();
    lastAppUpdateFetchKey = key;
    if (!r.ok) fetchError = ((r.stderr || '').trim() || `git fetch ${targetBranch} failed`);
  }
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
  const remoteHead = targetBranch === 'unknown'
    ? { ok: false, stdout: '' }
    : await run('git', ['rev-parse', `origin/${targetBranch}`], { cwd: ROOT });
  const localCommit = head.ok ? head.stdout.trim() : '';
  const remoteCommit = remoteHead.ok ? remoteHead.stdout.trim() : '';
  // Compare committed package.json versions, not the boot-snapshot, to avoid dirty-working-tree false positives
  let committedLocalVersion = APP_VERSION;
  const localPkg = await run('git', ['show', 'HEAD:package.json'], { cwd: ROOT });
  if (localPkg.ok) {
    try { committedLocalVersion = JSON.parse(localPkg.stdout).version || APP_VERSION; } catch {}
  }
  let remoteVersion = APP_VERSION;
  if (targetBranch !== 'unknown') {
    const remotePkg = await run('git', ['show', `origin/${targetBranch}:package.json`], { cwd: ROOT });
    if (remotePkg.ok) {
      try { remoteVersion = JSON.parse(remotePkg.stdout).version || APP_VERSION; } catch {}
    }
  }
  // Inspect the highest v* tag so a tag-only bump (same SHA, same package.json
  // content, but a new tag pointing at HEAD) is still surfaced as an update.
  // `git tag --list v* --sort=-v:refname` returns versions newest-first, so
  // the first non-empty line is the latest tag.
  let latestTag = '';
  const tagList = await run('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { cwd: ROOT });
  if (tagList.ok && tagList.stdout.trim()) {
    latestTag = tagList.stdout.trim().split('\n')[0].replace(/^v/, '');
  }
  let tagAhead = false;
  if (latestTag && committedLocalVersion) {
    try {
      const semver = (await import('semver')).default;
      tagAhead = semver.gt(latestTag, committedLocalVersion);
    } catch {}
  }
  // Only fire version-string signal on history-rewrite case (SHAs match but versions differ)
  const versionChanged = Boolean(remoteVersion && committedLocalVersion && remoteVersion !== committedLocalVersion);
  const updateAvailable = Boolean(
    (localCommit && remoteCommit && localCommit !== remoteCommit) ||
    (versionChanged && remoteCommit && localCommit === remoteCommit) ||
    (tagAhead && remoteCommit && localCommit === remoteCommit)
  );
  return {
    version: APP_VERSION,
    localVersion: committedLocalVersion,
    remoteVersion,
    availableVersion: tagAhead
      ? latestTag
      : (updateAvailable ? remoteVersion : committedLocalVersion),
    branch: targetBranch,
    updateChannel: channel,
    currentBranch,
    localCommit,
    remoteCommit,
    updateAvailable,
    fetchError,
  };
}

app.get('/api/status', async (req, res) => {
  const settings = await loadSettings();
  const decoded = authenticatedUser(req);
  const authenticated = Boolean(decoded);
  const canDiscover = authenticated || normalizeSettings(settings).users.length === 0;
  res.json({
    settings: statusSettings(settings, authenticated, decoded?.username || ''),
    authenticated,
    discovered: canDiscover
      ? { caddyfiles: await scanCaddyfiles(), logfiles: await scanLogfiles(settings) }
      : { caddyfiles: [], logfiles: [] },
  });
});

app.post('/api/setup/user', requireTrustedOrigin, requireSetupOrigin, async (req, res) => {
  const settings = await loadSettings();
  if (normalizeSettings(settings).users.length > 0) {
    return res.status(409).json({ error: 'Admin user is already configured.' });
  }
  const { username, password, setupToken } = req.body || {};
  const setupRateKey = `setup:${clientIp(req)}`;
  if (tooManyAttempts(setupRateKey)) {
    return res.status(429).json({ error: 'Too many setup attempts.' });
  }
  if (setupTokenRequired(settings) && !secureEqual(setupToken, SETUP_TOKEN)) {
    recordFailedAttempt(setupRateKey);
    return res.status(403).json({ error: 'Invalid setup token.' });
  }
  if (!validUsername(username) || !validPassword(password)) {
    recordFailedAttempt(setupRateKey);
    return res.status(400).json({ error: `Username format is invalid or password must be 8-${MAX_PASSWORD_LENGTH} characters.` });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const next = { ...settings, configured: false, users: [{ username: String(username).trim(), passwordHash, role: 'admin' }] };
  await saveSettings(next);
  clearAttempts(setupRateKey);
  res.cookie(COOKIE_NAME, sign(String(username).trim()), cookieOptions(req));
  res.json({
    settings: publicSettings(next, String(username).trim()),
    discovered: { caddyfiles: await scanCaddyfiles(), logfiles: await scanLogfiles(next) },
  });
});

app.post('/api/setup/config', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  const settings = await loadSettings();
  const { caddyfilePath, logPaths = [], caddyApiUrl, caddyApiToken, caddyApiSecret, caddyApiTokenClear, caddyApiSecretClear } = req.body || {};
  const nextConfigMode = 'api';
  const requestedCaddyfilePath = String(caddyfilePath || '').trim();
  const nextCaddyApiUrl = normalizeApiUrl(caddyApiUrl, settings.caddyApiUrl || DEFAULT_CADDY_API_URL);
  if (!nextCaddyApiUrl) {
    return res.status(400).json({ error: 'Caddy API URL is required.' });
  }

  const allowedLogs = [];
  for (const candidate of [...new Set([...logPaths, ...COMMON_LOGS].filter(Boolean))]) {
    if (await allowedLogPath(candidate)) allowedLogs.push(candidate);
  }

  let nextCaddyApiToken = settings.caddyApiToken || DEFAULT_CADDY_API_TOKEN;
  const providedSecret = typeof caddyApiSecret === 'string' && caddyApiSecret.trim() ? caddyApiSecret.trim() : '';
  const providedToken = typeof caddyApiToken === 'string' && caddyApiToken.trim() ? caddyApiToken.trim() : '';
  if (caddyApiTokenClear === true || caddyApiSecretClear === true) nextCaddyApiToken = '';
  else if (providedSecret) nextCaddyApiToken = providedSecret;
  else if (providedToken) nextCaddyApiToken = providedToken;

  const next = {
    ...settings,
    configured: true,
    configMode: nextConfigMode,
    caddyfilePath: requestedCaddyfilePath || settings.caddyfilePath,
    caddyApiUrl: nextCaddyApiUrl,
    caddyApiToken: nextCaddyApiToken,
    logPaths: allowedLogs,
  };
  await saveSettings(next);
  if (requestedCaddyfilePath && fssync.existsSync(requestedCaddyfilePath)) {
    try {
      await saveWorkingConfig(await fs.readFile(requestedCaddyfilePath, 'utf8'));
    } catch {}
  } else {
    const store = await stateStore;
    const existing = await store.getJson('working_config', null);
    if (typeof existing?.content !== 'string') await saveWorkingConfig('');
  }
  res.json({
    settings: publicSettings(next, req.user.username),
    discovered: { caddyfiles: await scanCaddyfiles(), logfiles: await scanLogfiles(next) },
  });
});

app.post('/api/login', requireTrustedOrigin, async (req, res) => {
  const settings = await loadSettings();
  const { username, password } = req.body || {};
  const normalizedUsername = String(username || '').trim();
  const rateKey = `${clientIp(req)}:${normalizedUsername}`;
  if (tooManyAttempts(rateKey)) return res.status(429).json({ error: 'Too many login attempts.' });

  const user = currentUserRecord(settings, normalizedUsername);
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    recordFailedAttempt(rateKey);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  clearAttempts(rateKey);
  res.cookie(COOKIE_NAME, sign(user.username), cookieOptions(req));
  res.json({ settings: publicSettings(settings, user.username) });
});

app.post('/api/logout', requireTrustedOrigin, async (req, res) => {
  const token = req.cookies[COOKIE_NAME] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      await revokeToken(jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }));
    } catch {}
  }
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
  res.json({ ok: true });
});

app.post('/api/caddy/load', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const settings = await loadSettings();
    const contentInput = req.body?.content;
    if (contentInput === undefined) return res.status(400).json({ error: 'Config content is required.' });
    const format = String(req.body?.format || 'caddyfile').trim().toLowerCase();
    const content =
      typeof contentInput === 'string' ? contentInput : format === 'json' || format === 'application/json' ? JSON.stringify(contentInput) : '';
    if (!content.trim()) return res.status(400).json({ error: 'Config content is required.' });
    const contentType =
      format === 'json' || format === 'application/json'
        ? 'application/json'
        : format.includes('/')
          ? format
          : format === 'caddyfile'
            ? 'text/caddyfile'
            : `text/${format}`;
    const headers = { 'Content-Type': contentType };
    if (req.body?.forceReload === true) headers['Cache-Control'] = 'must-revalidate';
    const response = await requestCaddyApi(settings, '/load', {
      method: 'POST',
      headers,
      body: content,
      timeoutMs: 12000,
    });
    const result = await caddyResponseData(response);
    if (response.ok && contentType === 'text/caddyfile') await saveWorkingConfig(content);
    if (result.etag) res.setHeader('ETag', result.etag);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      etag: result.etag,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

app.post('/api/caddy/stop', requireTrustedOrigin, auth, requirePermission('admin'), async (_req, res) => {
  try {
    const settings = await loadSettings();
    const response = await requestCaddyApi(settings, '/stop', { method: 'POST', timeoutMs: 8000 });
    const result = await caddyResponseData(response);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

app.post('/api/caddy/adapt', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const settings = await loadSettings();
    const contentInput = req.body?.content;
    if (contentInput === undefined) return res.status(400).json({ error: 'Config content is required.' });
    const format = String(req.body?.format || 'caddyfile').trim().toLowerCase();
    const content =
      typeof contentInput === 'string' ? contentInput : format === 'json' || format === 'application/json' ? JSON.stringify(contentInput) : '';
    if (!content.trim()) return res.status(400).json({ error: 'Config content is required.' });
    const contentType =
      format === 'json' || format === 'application/json'
        ? 'application/json'
        : format.includes('/')
          ? format
          : format === 'caddyfile'
            ? 'text/caddyfile'
            : `text/${format}`;
    const response = await requestCaddyApi(settings, '/adapt', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: content,
      timeoutMs: 12000,
    });
    const result = await caddyResponseData(response);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

const caddyConfigRoutes = ['/api/caddy/config', '/api/caddy/config/{*path}'];
const caddyIdRoutes = ['/api/caddy/id/:id', '/api/caddy/id/:id/{*path}'];

app.get(caddyConfigRoutes, auth, requirePermission('view'), async (req, res) => {
  try {
    const settings = await loadSettings();
    const scope = caddyPathPart(req.params.path || req.query.path || '');
    const response = await requestCaddyApi(settings, caddyEndpoint('/config', scope), { method: 'GET', timeoutMs: 8000 });
    const result = await caddyResponseData(response);
    if (result.etag) res.setHeader('ETag', result.etag);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      etag: result.etag,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

for (const method of ['post', 'put', 'patch', 'delete']) {
  app[method](caddyConfigRoutes, requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
    try {
      const settings = await loadSettings();
      const scope = caddyPathPart(req.params.path || req.query.path || '');
      const payload = caddyMutationBody(req);
      const headers = { 'Content-Type': 'application/json' };
      const ifMatch = caddyIfMatch(req);
      if (ifMatch) headers['If-Match'] = ifMatch;
      const response = await requestCaddyApi(settings, caddyEndpoint('/config', scope), {
        method: method.toUpperCase(),
        headers,
        body: method === 'delete' && payload === undefined ? undefined : caddyPayload(payload),
        timeoutMs: 12000,
      });
      const result = await caddyResponseData(response);
      if (result.etag) res.setHeader('ETag', result.etag);
      return res.status(result.status).json({
        ok: result.ok,
        status: result.status,
        etag: result.etag,
        value: result.data,
        error: result.ok ? '' : result.raw,
      });
    } catch (error) {
      return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
    }
  });
}

app.get(caddyIdRoutes, auth, requirePermission('view'), async (req, res) => {
  try {
    const settings = await loadSettings();
    const id = caddyPathPart(req.params.id || req.query.id || '');
    if (!id) return res.status(400).json({ error: 'ID path is required.' });
    const tail = caddyPathPart(req.params.path || req.query.path || '');
    const endpoint = tail ? `/id/${id}/${tail}` : `/id/${id}`;
    const response = await requestCaddyApi(settings, endpoint, { method: 'GET', timeoutMs: 8000 });
    const result = await caddyResponseData(response);
    if (result.etag) res.setHeader('ETag', result.etag);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      etag: result.etag,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

for (const method of ['post', 'put', 'patch', 'delete']) {
  app[method](caddyIdRoutes, requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
    try {
      const settings = await loadSettings();
      const id = caddyPathPart(req.params.id || req.query.id || '');
      if (!id) return res.status(400).json({ error: 'ID path is required.' });
      const tail = caddyPathPart(req.params.path || req.query.path || '');
      const endpoint = tail ? `/id/${id}/${tail}` : `/id/${id}`;
      const payload = caddyMutationBody(req);
      const headers = { 'Content-Type': 'application/json' };
      const ifMatch = caddyIfMatch(req);
      if (ifMatch) headers['If-Match'] = ifMatch;
      const response = await requestCaddyApi(settings, endpoint, {
        method: method.toUpperCase(),
        headers,
        body: method === 'delete' && payload === undefined ? undefined : caddyPayload(payload),
        timeoutMs: 12000,
      });
      const result = await caddyResponseData(response);
      if (result.etag) res.setHeader('ETag', result.etag);
      return res.status(result.status).json({
        ok: result.ok,
        status: result.status,
        etag: result.etag,
        value: result.data,
        error: result.ok ? '' : result.raw,
      });
    } catch (error) {
      return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
    }
  });
}

app.get('/api/caddy/pki/ca/:id', auth, requirePermission('view'), async (req, res) => {
  try {
    const settings = await loadSettings();
    const id = encodeURIComponent(String(req.params.id || '').trim());
    if (!id) return res.status(400).json({ error: 'CA ID is required.' });
    const response = await requestCaddyApi(settings, `/pki/ca/${id}`, { method: 'GET', timeoutMs: 8000 });
    const result = await caddyResponseData(response);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

app.get('/api/caddy/pki/ca/:id/certificates', auth, requirePermission('view'), async (req, res) => {
  try {
    const settings = await loadSettings();
    const id = encodeURIComponent(String(req.params.id || '').trim());
    if (!id) return res.status(400).json({ error: 'CA ID is required.' });
    const response = await requestCaddyApi(settings, `/pki/ca/${id}/certificates`, { method: 'GET', timeoutMs: 8000 });
    const result = await caddyResponseData(response);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

app.get('/api/caddy/reverse_proxy/upstreams', auth, requirePermission('view'), async (_req, res) => {
  try {
    const settings = await loadSettings();
    const response = await requestCaddyApi(settings, '/reverse_proxy/upstreams', { method: 'GET', timeoutMs: 8000 });
    const result = await caddyResponseData(response);
    return res.status(result.status).json({
      ok: result.ok,
      status: result.status,
      value: result.data,
      error: result.ok ? '' : result.raw,
    });
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Caddy API is unavailable.' });
  }
});

// Rate-limit only the ?health=1 branch (TCP probing of user-configured upstreams).
// Shared 30 req/min budget with /api/proxies/health so callers cannot bypass the
// ceiling by hitting this route instead.
const configHealthRateLimit = requireRateLimit('config-health', 30, 60_000);

app.get(
  '/api/config',
  auth,
  requirePermission('view'),
  (req, res, next) => {
    if (String(req.query.health || '0') === '1') {
      return configHealthRateLimit(req, res, next);
    }
    return next();
  },
  async (req, res) => {
    try {
      const { content, path } = await readWorkingConfig();
      const parsed = await parseConfigWithMeta(content);
      const wantsHealth = String(req.query.health || '0') === '1';
      // /api/config?health=1 is open to view users; rate limit applies.
      res.json({
        path,
        content,
        parsed,
        health: wantsHealth ? await checkProxyHealth(parsed) : {},
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.post('/api/config', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const settings = await loadSettings();
    const { content, validate = true } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'Config content is required.' });

    if (validate) {
      const validation = await validateConfigForSettings(settings, content);
      if (!validation.ok) {
        return res.status(400).json({ error: 'Caddy validation failed.', validation, parsed: await parseConfigWithMeta(content) });
      }
    }

    const { backup } = await applyConfigContent(settings, content, { backup: true });
    const parsed = await parseConfigWithMeta(content);
    await pruneProxyMetaForParsed(parsed);
    res.json({ ok: true, backup, parsed, content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// view users can read health status (TCP reachability of user-configured upstreams).
// Rate-limited to 30 req/min/IP to bound burst load.
app.get('/api/proxies/health', auth, requirePermission('view'), requireRateLimit('proxies-health', 30, 60_000), async (_req, res) => {
  try {
    const { content } = await readWorkingConfig();
    const parsed = await parseConfigWithMeta(content);
    res.json({ health: await checkProxyHealth(parsed) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/validate', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  const settings = await loadSettings();
  const content = typeof req.body?.content === 'string' ? req.body.content : (await readWorkingConfig()).content;
  res.json(await validateConfigForSettings(settings, content));
});

app.post('/api/config/format', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  const content = typeof req.body?.content === 'string' ? req.body.content : (await readWorkingConfig()).content;
  const result = await formatConfig(content);
  if (result.ok) return res.json(result);
  return res.status(result.unavailable ? 503 : 400).json(result);
});

app.post('/api/config/reload', requireTrustedOrigin, auth, requirePermission('edit'), async (_req, res) => {
  const settings = await loadSettings();
  try {
    const { content } = await readWorkingConfig();
    if (!content.trim()) {
      return res.status(400).json({ ok: false, code: 400, stdout: '', stderr: 'No config content available to reload.' });
    }
    const response = await requestCaddyApi(settings, '/load', {
      method: 'POST',
      headers: { 'Content-Type': 'text/caddyfile', 'Cache-Control': 'must-revalidate' },
      body: content,
      timeoutMs: 12000,
    });
    if (!response.ok) {
      const stderr = (await response.text()) || `Caddy API reload failed (${response.status}).`;
      return res.status(400).json({ ok: false, code: response.status, stdout: '', stderr });
    }
    return res.json({ ok: true, code: 0, stdout: 'Reloaded Caddy via admin API.', stderr: '' });
  } catch (error) {
    return res.status(503).json({ ok: false, code: -1, stdout: '', stderr: error.message || 'Caddy API is unavailable.' });
  }
  const result = await run('caddy', ['reload', '--config', settings.caddyfilePath, '--adapter', 'caddyfile']);
  if (result.code === -1) {
    return res.status(503).json({
      ...result,
      stderr: 'Caddy binary is not available in this container. Run CaddyUI where it can execute caddy reload.',
    });
  }
  return res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/proxies', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const { settings, content } = await readWorkingConfig();
    const next = appendSimpleProxy(content, req.body || {});
    const validation = await validateConfigForSettings(settings, next);
    if (!validation.ok && !validation.unavailable) {
      return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed: await parseConfigWithMeta(next) });
    }
    await applyConfigContent(settings, next);
    await saveProxyMetaByParts(req.body?.host, req.body?.upstream, req.body?.tags, req.body?.category, req.body?.description);
    const parsed = await parseConfigWithMeta(next);
    res.json({ ok: true, validation, parsed, health: await checkProxyHealth(parsed), content: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/proxies/:line', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const { settings, content } = await readWorkingConfig();
    const previousParsed = await parseConfigCached(content);
    const previousSite = previousParsed.sites.find((site) => String(site.line) === String(req.params.line));
    const previousMetaKey = proxyMetaKeyFromSite(previousSite);
    const next = updateSimpleProxy(content, { ...req.body, siteLine: req.params.line });
    const validation = await validateConfigForSettings(settings, next);
    if (!validation.ok && !validation.unavailable) {
      return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed: await parseConfigWithMeta(next) });
    }
    await applyConfigContent(settings, next);
    const nextMetaKey = proxyMetaKeyFromParts(req.body?.host, req.body?.upstream);
    if (previousMetaKey && nextMetaKey && previousMetaKey !== nextMetaKey) {
      const store = await stateStore;
      await store.deleteProxyMeta(previousMetaKey);
    }
    await saveProxyMetaByParts(req.body?.host, req.body?.upstream, req.body?.tags, req.body?.category, req.body?.description);
    const parsed = await parseConfigWithMeta(next);
    res.json({ ok: true, validation, parsed, health: await checkProxyHealth(parsed), content: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/proxies/:line', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const { settings, content } = await readWorkingConfig();
    const previousParsed = await parseConfigCached(content);
    const previousSite = previousParsed.sites.find((site) => String(site.line) === String(req.params.line));
    const next = deleteBlockAtLine(content, req.params.line);
    const validation = await validateConfigForSettings(settings, next);
    if (!validation.ok && !validation.unavailable) {
      return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed: await parseConfigWithMeta(next) });
    }
    await applyConfigContent(settings, next);
    await deleteProxyMetaForSite(previousSite);
    const parsed = await parseConfigWithMeta(next);
    res.json({ ok: true, validation, parsed, health: await checkProxyHealth(parsed), content: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/proxies/:line/disabled', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const { settings, content } = await readWorkingConfig();
    const disabled = req.body?.disabled !== false;
    const next = setProxyDisabled(content, { siteLine: req.params.line, disabled });
    const validation = await validateConfigForSettings(settings, next);
    if (!validation.ok && !validation.unavailable) {
      return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed: await parseConfigWithMeta(next) });
    }
    await applyConfigContent(settings, next);
    const parsed = await parseConfigWithMeta(next);
    res.json({ ok: true, validation, parsed, health: await checkProxyHealth(parsed), content: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post(
  '/api/proxies/bulk-disabled',
  requireTrustedOrigin,
  auth,
  requirePermission('edit'),
  requireRateLimit('proxies-bulk-disabled', 12, 60_000),
  async (req, res) => {
    try {
      const actions = Array.isArray(req.body?.actions) ? req.body.actions : null;
      if (!actions || actions.length === 0 || actions.length > 200) {
        return res.status(400).json({ error: 'actions array required, 1-200 entries' });
      }
      const { settings, content } = await readWorkingConfig();
      let nextContent = content;
      const errors = [];
      let applied = 0;
      for (const action of actions) {
        if (
          !action ||
          typeof action.line === 'undefined' ||
          typeof action.disabled !== 'boolean'
        ) {
          errors.push({ line: action?.line, message: 'invalid shape' });
          continue;
        }
        try {
          nextContent = setProxyDisabled(nextContent, {
            siteLine: action.line,
            disabled: action.disabled,
          });
          applied++;
        } catch (err) {
          errors.push({ line: action.line, message: err.message });
        }
      }
      const validation = await validateConfigForSettings(settings, nextContent);
      if (!validation.ok && !validation.unavailable) {
        const parsed = await parseConfigWithMeta(nextContent);
        return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed });
      }
      const finalParsed = await parseConfigWithMeta(nextContent);
      await applyConfigContent(settings, nextContent);
      const health = await checkProxyHealth(finalParsed);
      res.json({ ok: true, validation, applied, errors, content: nextContent, parsed: finalParsed, health });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.post(
  '/api/proxies/bulk-delete',
  requireTrustedOrigin,
  auth,
  requirePermission('edit'),
  requireRateLimit('proxies-bulk-delete', 12, 60_000),
  async (req, res) => {
    try {
      const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
      if (!lines || lines.length === 0 || lines.length > 200) {
        return res.status(400).json({ error: 'lines array required, 1-200 entries' });
      }
      // Sort descending so deleting a higher line first does not invalidate lower line numbers.
      const sortedLines = [...lines]
        .map((line) => Number(line))
        .filter((line) => Number.isFinite(line) && line > 0)
        .sort((a, b) => b - a);
      if (!sortedLines.length) {
        return res.status(400).json({ error: 'lines array contained no valid positive integers' });
      }
      const { settings, content } = await readWorkingConfig();
      const previousParsed = await parseConfigCached(content);
      const sitesToCleanup = previousParsed.sites.filter((site) => sortedLines.includes(Number(site.line)));
      let nextContent = content;
      const errors = [];
      let applied = 0;
      for (const line of sortedLines) {
        try {
          nextContent = deleteBlockAtLine(nextContent, line);
          applied++;
        } catch (err) {
          errors.push({ line, message: err.message });
        }
      }
      const validation = await validateConfigForSettings(settings, nextContent);
      if (!validation.ok && !validation.unavailable) {
        const parsed = await parseConfigWithMeta(nextContent);
        return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed });
      }
      const finalParsed = await parseConfigWithMeta(nextContent);
      await applyConfigContent(settings, nextContent);
      for (const site of sitesToCleanup) {
        await deleteProxyMetaForSite(site);
      }
      const health = await checkProxyHealth(finalParsed);
      res.json({ ok: true, validation, applied, errors, content: nextContent, parsed: finalParsed, health });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.post('/api/middlewares', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const { settings, content } = await readWorkingConfig();
    const next = appendSnippet(content, req.body || {});
    const validation = await validateConfigForSettings(settings, next);
    if (!validation.ok && !validation.unavailable) {
      return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed: await parseConfigWithMeta(next) });
    }
    await applyConfigContent(settings, next);
    res.json({ ok: true, validation, parsed: await parseConfigWithMeta(next), content: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/middlewares/:line', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const { settings, content } = await readWorkingConfig();
    const next = updateSnippet(content, { ...req.body, line: req.params.line });
    const validation = await validateConfigForSettings(settings, next);
    if (!validation.ok && !validation.unavailable) {
      return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed: await parseConfigWithMeta(next) });
    }
    await applyConfigContent(settings, next);
    res.json({ ok: true, validation, parsed: await parseConfigWithMeta(next), content: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/middlewares/:line', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  try {
    const { settings, content } = await readWorkingConfig();
    const next = deleteBlockAtLine(content, req.params.line);
    const validation = await validateConfigForSettings(settings, next);
    if (!validation.ok && !validation.unavailable) {
      return res.status(400).json({ error: 'Generated Caddyfile did not validate.', validation, parsed: await parseConfigWithMeta(next) });
    }
    await applyConfigContent(settings, next);
    res.json({ ok: true, validation, parsed: await parseConfigWithMeta(next), content: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/logs', auth, requirePermission('view'), async (req, res) => {
  const settings = await loadSettings();
  const requested = Number(req.query.lines || 200);
  const bounded = Number.isFinite(requested) ? Math.max(10, Math.min(2000, Math.floor(requested))) : 200;
  const mode = ['all', 'files', 'journal'].includes(String(req.query.mode || 'all')) ? String(req.query.mode || 'all') : 'all';
  res.json({ logs: await collectLogs({ ...settings, logMode: mode }, bounded) });
});

app.get('/api/settings', auth, requirePermission('view'), async (req, res) => {
  const settings = await loadSettings();
  res.json({
    settings: publicSettings(settings, req.user.username),
    discovered: { caddyfiles: await scanCaddyfiles(), logfiles: await scanLogfiles(settings) },
  });
});

app.post('/api/settings', requireTrustedOrigin, auth, requirePermission('edit'), async (req, res) => {
  const settings = await loadSettings();
  const {
    caddyApiUrl,
    caddyApiToken,
    caddyApiSecret,
    caddyApiTokenClear,
    caddyApiSecretClear,
    logPaths,
    trustProxyHops,
    allowRemoteSetup,
    secureCookieMode,
    allowedOrigins,
    aiEnabled,
    aiProvider,
    aiBaseUrl,
    aiModel,
    aiAllowPrivateBaseUrl,
    aiApiKey,
    aiApiKeyClear,
  } = req.body || {};
  const requestedMode = 'api';
  const requestedCaddyApiUrl = caddyApiUrl === undefined ? settings.caddyApiUrl : normalizeApiUrl(caddyApiUrl, settings.caddyApiUrl);
  if (!requestedCaddyApiUrl) {
    return res.status(400).json({ error: 'Caddy API URL is required.' });
  }
  const updatingSecuritySettings =
    trustProxyHops !== undefined ||
    allowRemoteSetup !== undefined ||
    secureCookieMode !== undefined ||
    allowedOrigins !== undefined;
  if (updatingSecuritySettings && !hasPermission(req.user?.role, 'admin')) {
    return res.status(403).json({ error: 'Admin permission required for security settings.' });
  }
  const updatingAiSettings =
    aiEnabled !== undefined ||
    aiProvider !== undefined ||
    aiBaseUrl !== undefined ||
    aiModel !== undefined ||
    aiAllowPrivateBaseUrl !== undefined ||
    aiApiKey !== undefined ||
    aiApiKeyClear !== undefined;
  if (updatingAiSettings && !hasPermission(req.user?.role, 'admin')) {
    return res.status(403).json({ error: 'Admin permission required for AI settings.' });
  }

  const nextLogPaths = [];
  for (const candidate of Array.isArray(logPaths) ? logPaths.filter(Boolean) : settings.logPaths) {
    if (await allowedLogPath(candidate)) nextLogPaths.push(candidate);
  }

  let nextCaddyApiToken = settings.caddyApiToken || DEFAULT_CADDY_API_TOKEN;
  const providedSecret = typeof caddyApiSecret === 'string' && caddyApiSecret.trim() ? caddyApiSecret.trim() : '';
  const providedToken = typeof caddyApiToken === 'string' && caddyApiToken.trim() ? caddyApiToken.trim() : '';
  if (caddyApiTokenClear === true || caddyApiSecretClear === true) nextCaddyApiToken = '';
  else if (providedSecret) nextCaddyApiToken = providedSecret;
  else if (providedToken) nextCaddyApiToken = providedToken;

  let nextAiApiKeyEncrypted = settings.aiApiKeyEncrypted || null;
  if (updatingAiSettings) {
    if (aiApiKeyClear === true) nextAiApiKeyEncrypted = null;
    else if (typeof aiApiKey === 'string' && aiApiKey.trim()) nextAiApiKeyEncrypted = encryptAiApiKey(aiApiKey, JWT_SECRET);
  }
  const nextAiProvider = aiProvider === undefined ? settings.aiProvider : aiProvider === 'anthropic' ? 'anthropic' : 'openai';
  const nextAiBaseUrl = aiBaseUrl === undefined ? settings.aiBaseUrl : String(aiBaseUrl || '').trim();
  const nextAiAllowPrivate = aiAllowPrivateBaseUrl === undefined ? settings.aiAllowPrivateBaseUrl : aiAllowPrivateBaseUrl === true;
  const nextAiModel = aiModel === undefined ? settings.aiModel : String(aiModel || '').trim();
  if (updatingAiSettings && nextAiBaseUrl && (aiEnabled === true || nextAiBaseUrl)) {
    await validateAiBaseUrl(nextAiBaseUrl, { allowPrivate: nextAiAllowPrivate });
  }

  const next = {
    ...settings,
    configMode: requestedMode,
    caddyApiUrl: requestedCaddyApiUrl,
    caddyApiToken: nextCaddyApiToken,
    aiEnabled: aiEnabled === undefined ? Boolean(settings.aiEnabled) : aiEnabled === true,
    aiProvider: nextAiProvider,
    aiBaseUrl: nextAiBaseUrl,
    aiModel: nextAiModel,
    aiAllowPrivateBaseUrl: nextAiAllowPrivate,
    aiApiKeyEncrypted: nextAiApiKeyEncrypted,
    logPaths: nextLogPaths,
    trustProxyHops:
      trustProxyHops === undefined ? settings.trustProxyHops : normalizeTrustProxyHops(trustProxyHops, settings.trustProxyHops),
    allowRemoteSetup:
      allowRemoteSetup === undefined ? settings.allowRemoteSetup : normalizeBoolean(allowRemoteSetup, settings.allowRemoteSetup),
    secureCookieMode:
      secureCookieMode === undefined ? settings.secureCookieMode : normalizeCookieMode(secureCookieMode, settings.secureCookieMode),
    allowedOrigins:
      allowedOrigins === undefined ? settings.allowedOrigins : normalizeAllowedOrigins(allowedOrigins),
  };
  await saveSettings(next);
  const store = await stateStore;
  const existing = await store.getJson('working_config', null);
  if (typeof existing?.content !== 'string') {
    if (settings.caddyfilePath && fssync.existsSync(settings.caddyfilePath)) {
      try {
        await saveWorkingConfig(await fs.readFile(settings.caddyfilePath, 'utf8'));
      } catch {
        await saveWorkingConfig('');
      }
    } else {
      await saveWorkingConfig('');
    }
  }
  res.json({ settings: publicSettings(next, req.user.username) });
});

app.post('/api/settings/test-api', requireTrustedOrigin, auth, requirePermission('edit'), requireRateLimit('test-api', 20, 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const providedUrl = normalizeApiUrl(req.body?.caddyApiUrl, settings.caddyApiUrl || DEFAULT_CADDY_API_URL);
  const providedSecret =
    typeof req.body?.caddyApiSecret === 'string' && req.body.caddyApiSecret.trim()
      ? req.body.caddyApiSecret.trim()
      : typeof req.body?.caddyApiToken === 'string' && req.body.caddyApiToken.trim()
        ? req.body.caddyApiToken.trim()
        : settings.caddyApiToken;
  if (!providedUrl) return res.status(400).json({ error: 'Caddy API URL is required.' });
  try {
    const result = await testCaddyApiConnection(settings, { caddyApiUrl: providedUrl, caddyApiToken: providedSecret });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return res.status(503).json({ ok: false, message: error.message || 'Caddy API is unavailable.' });
  }
});

app.post('/api/ai/settings/test', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('test-ai', 10, 5 * 60 * 1000), async (req, res) => {
  try {
    const settings = await loadSettings();
    const provider = req.body?.provider === 'anthropic' ? 'anthropic' : settings.aiProvider === 'anthropic' ? 'anthropic' : 'openai';
    const baseUrl = String(req.body?.baseUrl || settings.aiBaseUrl || '').trim();
    const model = String(req.body?.model || settings.aiModel || '').trim();
    const allowPrivate = req.body?.allowPrivateBaseUrl === true || Boolean(settings.aiAllowPrivateBaseUrl);
    await validateAiBaseUrl(baseUrl, { allowPrivate });
    const apiKey =
      String(req.body?.apiKey || '').trim() || decryptAiApiKey(settings.aiApiKeyEncrypted, JWT_SECRET);
    if (!apiKey || !model) {
      return res.status(400).json({ error: 'AI API key and model are required.' });
    }
    if (!baseUrl) {
      return res.status(400).json({ error: 'AI base URL is required.' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await callAiProvider({
        provider,
        baseUrl,
        apiKey,
        model,
        system: 'Reply with OK.',
        messages: [{ role: 'user', content: 'Connection test. Reply with OK.' }],
        tools: [],
        signal: controller.signal,
      });
      return res.json({ ok: true, message: result.text || 'AI provider connection succeeded.' });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'AI provider request timed out.' : error?.message || 'AI provider test failed.';
    return res.status(400).json({ error: message });
  }
});

app.get('/api/ai/status', auth, requirePermission('view'), async (req, res) => {
  const settings = await loadSettings();
  res.json({
    ...aiProviderConfig(settings),
    canEdit: hasPermission(req.user?.role, 'edit'),
    canAdmin: hasPermission(req.user?.role, 'admin'),
  });
});

app.get('/api/ai/conversations', auth, requirePermission('view'), async (req, res) => {
  const store = await stateStore;
  await store.pruneAiData();
  res.json({ conversations: await store.listAiConversations(req.user.username) });
});

app.post('/api/ai/conversations', requireTrustedOrigin, auth, requirePermission('view'), async (req, res) => {
  const store = await stateStore;
  const conversation = await store.createAiConversation({
    id: randomUUID(),
    username: req.user.username,
    title: summarizeText(req.body?.title || 'New conversation', 80),
    createdAt: Date.now(),
  });
  res.status(201).json({ conversation });
});

app.get('/api/ai/conversations/:id/messages', auth, requirePermission('view'), async (req, res) => {
  const store = await stateStore;
  const conversation = await store.getAiConversation(req.params.id, req.user.username);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ conversation, messages: await store.listAiMessages(req.params.id, req.user.username) });
});

app.delete('/api/ai/conversations/:id', requireTrustedOrigin, auth, requirePermission('view'), async (req, res) => {
  const store = await stateStore;
  const deleted = await store.deleteAiConversation(req.params.id, req.user.username);
  res.status(deleted ? 200 : 404).json(deleted ? { ok: true } : { error: 'Conversation not found.' });
});

app.post(
  '/api/ai/conversations/:id/messages',
  requireTrustedOrigin,
  auth,
  requirePermission('view'),
  requireRateLimit('ai-message', 20, 10 * 60 * 1000),
  async (req, res) => {
    try {
      const text = String(req.body?.message || '').trim();
      if (!text || text.length > 8000) {
        return res.status(400).json({ error: 'Message must be between 1 and 8000 characters.' });
      }
      const settings = await loadSettings();
      const providerConfig = aiProviderConfig(settings);
      if (!providerConfig.configured) return res.status(503).json({ error: 'AI assistant is not configured.' });
      await validateAiBaseUrl(providerConfig.baseUrl, { allowPrivate: settings.aiAllowPrivateBaseUrl });
      const apiKey = decryptAiApiKey(settings.aiApiKeyEncrypted, JWT_SECRET);
      if (!apiKey) return res.status(503).json({ error: 'AI API key could not be decrypted. Save it again in Settings.' });
      const store = await stateStore;
      const conversation = await store.getAiConversation(req.params.id, req.user.username);
      if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
      await store.appendAiMessage({
        id: randomUUID(),
        conversationId: conversation.id,
        username: req.user.username,
        role: 'user',
        content: text,
        createdAt: Date.now(),
      });
      const messages = await store.listAiMessages(conversation.id, req.user.username);
      const context = await aiContextForUser(req.user);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      let result;
      try {
        result = await runAiAssistant({
          providerConfig,
          user: req.user,
          conversationId: conversation.id,
          messages,
          context,
          store,
          apiKey,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const assistantMessage = await store.appendAiMessage({
        id: randomUUID(),
        conversationId: conversation.id,
        username: req.user.username,
        role: 'assistant',
        content: { text: result.text, proposals: result.proposals },
        createdAt: Date.now(),
      });
      res.json({ message: assistantMessage, proposals: result.proposals });
    } catch (error) {
      const status = error?.name === 'AbortError' ? 408 : 400;
      res.status(status).json({ error: error?.name === 'AbortError' ? 'AI provider request timed out.' : error?.message });
    }
  }
);

app.post('/api/ai/actions/:id/reject', requireTrustedOrigin, auth, requirePermission('view'), async (req, res) => {
  const store = await stateStore;
  const rejected = await store.rejectAiPendingAction(req.params.id, req.user.username);
  res.status(rejected ? 200 : 404).json(rejected ? { ok: true } : { error: 'Pending action not found.' });
});

app.post(
  '/api/ai/actions/:id/confirm',
  requireTrustedOrigin,
  auth,
  requirePermission('edit'),
  requireRateLimit('ai-confirm', 20, 10 * 60 * 1000),
  async (req, res) => {
    const store = await stateStore;
    const action = await store.consumeAiPendingAction(req.params.id, req.user.username);
    if (!action) return res.status(409).json({ error: 'Action expired, was already used, or was not found.' });
    try {
      const { settings, content } = await readWorkingConfig();
      const currentFingerprint = createHash('sha256').update(String(content)).digest('hex');
      if (action.preview?.configFingerprint && action.preview.configFingerprint !== currentFingerprint) {
        throw new Error('Configuration changed since this action was proposed. Ask the assistant to prepare it again.');
      }
      let next = content;
      if (action.actionType === 'create_proxy') {
        if (!canUserEditProxyTarget(req.user, { host: action.args.host, category: action.args.category })) {
          throw new Error('Proxy is outside your allowed scope.');
        }
        next = appendSimpleProxy(content, action.args);
      } else if (action.actionType === 'update_proxy') {
        const parsed = parseCaddyfile(content);
        const previous = (parsed.sites || []).find((site) => Number(site.line) === Number(action.args.line));
        if (!previous) throw new Error('Proxy not found.');
        if (!canUserEditProxyTarget(req.user, { host: action.args.host, category: action.args.category })) {
          throw new Error('Proxy is outside your allowed scope.');
        }
        next = updateSimpleProxy(content, { ...action.args, siteLine: action.args.line });
      } else if (action.actionType === 'set_proxy_disabled') {
        const parsed = parseCaddyfile(content);
        const previous = (parsed.sites || []).find((site) => Number(site.line) === Number(action.args.line));
        if (!previous) throw new Error('Proxy not found.');
        if (!canUserEditProxyTarget(req.user, { host: previous.addresses?.[0] || '', category: previous.category || '' })) {
          throw new Error('Proxy is outside your allowed scope.');
        }
        next = setProxyDisabled(content, { siteLine: action.args.line, disabled: action.args.disabled === true });
      } else if (action.actionType === 'delete_proxy') {
        const parsed = parseCaddyfile(content);
        const previous = (parsed.sites || []).find((site) => Number(site.line) === Number(action.args.line));
        if (!previous) throw new Error('Proxy not found.');
        if (!canUserEditProxyTarget(req.user, { host: previous.addresses?.[0] || '', category: previous.category || '' })) {
          throw new Error('Proxy is outside your allowed scope.');
        }
        next = deleteBlockAtLine(content, action.args.line);
      } else if (action.actionType === 'reload_caddy') {
        await store.finishAiPendingAction(action.id, req.user.username, 'succeeded');
        return res.json({
          ok: true,
          action,
          requiresHeaderReload: true,
          message: 'Use the Reload Caddy confirmation in the header.',
        });
      } else {
        throw new Error('Unsupported AI action.');
      }
      const validation = await validateConfigForSettings(settings, next);
      if (!validation.ok && !validation.unavailable) {
        throw new Error('Generated Caddy configuration did not validate.');
      }
      await applyConfigContent(settings, next);
      if (['create_proxy', 'update_proxy'].includes(action.actionType)) {
        await saveProxyMetaByParts(
          action.args.host,
          action.args.upstream,
          action.args.tags,
          action.args.category,
          action.args.description
        );
      }
      const parsed = await parseConfigWithMeta(next);
      await store.finishAiPendingAction(action.id, req.user.username, 'succeeded');
      const event = await recordEvent(req, {
        kind: 'ai',
        action: action.actionType,
        targetType: 'proxy',
        targetId: action.args.host || String(action.args.line || ''),
        message: `AI-confirmed action ${action.actionType} succeeded.`,
        details: { conversationId: action.conversationId, actionId: action.id },
      });
      res.json({ ok: true, action, parsed, event, reloadSuggested: true });
    } catch (error) {
      await store.finishAiPendingAction(action.id, req.user.username, 'failed');
      if (!res.headersSent) res.status(400).json({ error: error.message });
    }
  }
);

app.post('/api/settings/reset-caddy-config', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('reset-caddy-config', 4, 15 * 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const confirmationUsername = String(req.body?.username || '').trim();
  if (!secureEqual(confirmationUsername, req.user.username)) {
    return res.status(400).json({ error: 'Confirmation username did not match your account.' });
  }
  const template = await loadResetConfigTemplate();
  const { backup } = await applyConfigContent(settings, template, { backup: true });
  await saveWorkingConfig(template);
  const parsed = await parseConfigWithMeta(template);
  await pruneProxyMetaForParsed(parsed);
  return res.json({ ok: true, backup, content: template, parsed });
});

app.post('/api/settings/reset-onboarding', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('reset-onboarding', 3, 15 * 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const confirmationUsername = String(req.body?.username || '').trim();
  if (!secureEqual(confirmationUsername, req.user.username)) {
    return res.status(400).json({ error: 'Confirmation username did not match your account.' });
  }
  const next = normalizeSettings({
    configured: false,
    configMode: 'api',
    caddyfilePath: '',
    caddyApiUrl: settings.caddyApiUrl || DEFAULT_CADDY_API_URL,
    caddyApiToken: '',
    logPaths: settings.logPaths || COMMON_LOGS,
    updateChannel: settings.updateChannel || 'stable',
    trustProxyHops: settings.trustProxyHops,
    allowRemoteSetup: settings.allowRemoteSetup,
    secureCookieMode: settings.secureCookieMode,
    allowedOrigins: settings.allowedOrigins,
    users: [],
  });
  await saveSettings(next);
  const store = await stateStore;
  await store.setJson('working_config', { content: '', updatedAt: new Date().toISOString() });
  await store.setJson('sessions', { revoked: {} });
  await store.pruneProxyMeta([]);
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
  return res.json({ ok: true, settings: statusSettings(next, false, '') });
});

app.put('/api/settings/update-channel', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('update-channel', 10, 5 * 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const channel = String(req.body?.updateChannel || '').trim().toLowerCase();
  if (!UPDATE_CHANNELS.has(channel)) {
    return res.status(400).json({ error: 'Invalid update channel.' });
  }
  const next = {
    ...settings,
    updateChannel: channel,
  };
  await saveSettings(next);
  res.json({ settings: publicSettings(next, req.user.username) });
});

app.get('/api/users', auth, requirePermission('admin'), async (_req, res) => {
  const settings = await loadSettings();
  res.json({ users: normalizeSettings(settings).users.map(exposeUser) });
});

app.post('/api/users', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('create-user', 12, 15 * 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const normalized = normalizeSettings(settings);
  const { username, password, role } = req.body || {};
  if (!validUsername(username) || !validPassword(password)) {
    return res.status(400).json({ error: `Username format is invalid or password must be 8-${MAX_PASSWORD_LENGTH} characters.` });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (currentUserRecord(normalized, username)) {
    return res.status(409).json({ error: 'User already exists.' });
  }

  normalized.users.push({
    username: String(username).trim(),
    passwordHash: await bcrypt.hash(password, 12),
    role,
  });
  await saveSettings(normalized);
  res.json({ users: normalized.users.map(exposeUser) });
});

app.put('/api/users/:username', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('update-user', 20, 15 * 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const normalized = normalizeSettings(settings);
  const user = currentUserRecord(normalized, req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { role, password } = req.body || {};
  if (role && !VALID_ROLES.has(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (role) {
    if (user.role === 'admin' && role !== 'admin' && adminCount(normalized) <= 1) {
      return res.status(400).json({ error: 'At least one admin user is required.' });
    }
    user.role = role;
  }

  if (password) {
    if (!validPassword(password)) {
      return res.status(400).json({ error: `Password must be 8-${MAX_PASSWORD_LENGTH} characters.` });
    }
    user.passwordHash = await bcrypt.hash(password, 12);
  }

  await saveSettings(normalized);
  res.json({ users: normalized.users.map(exposeUser) });
});

app.delete('/api/users/:username', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('delete-user', 12, 15 * 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const normalized = normalizeSettings(settings);
  if (req.user.username === req.params.username) {
    return res.status(400).json({ error: 'Cannot delete current user.' });
  }
  const target = currentUserRecord(normalized, req.params.username);
  if (target?.role === 'admin' && adminCount(normalized) <= 1) {
    return res.status(400).json({ error: 'At least one admin user is required.' });
  }

  normalized.users = normalized.users.filter((user) => user.username !== req.params.username);
  await saveSettings(normalized);
  res.json({ users: normalized.users.map(exposeUser) });
});

app.post('/api/account/password', requireTrustedOrigin, auth, requirePermission('view'), requireRateLimit('change-password', 8, 15 * 60 * 1000), async (req, res) => {
  const settings = await loadSettings();
  const normalized = normalizeSettings(settings);
  const user = currentUserRecord(normalized, req.user.username);
  const { currentPassword, newPassword } = req.body || {};
  if (!user || !(await bcrypt.compare(currentPassword || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Current password is invalid.' });
  }
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: `New password must be 8-${MAX_PASSWORD_LENGTH} characters.` });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await saveSettings(normalized);
  res.json({ ok: true });
});

app.get('/api/app/status', auth, requirePermission('view'), async (_req, res) => {
  res.json(await appUpdateStatus('auto'));
});

app.post('/api/app/check-updates', requireTrustedOrigin, auth, requirePermission('view'), async (req, res) => {
  const override = String(req.body?.updateChannel || '').trim().toLowerCase();
  const channelOverride = UPDATE_CHANNELS.has(override) ? override : '';
  res.json(await appUpdateStatus(true, channelOverride));
});

app.post('/api/app/update', requireTrustedOrigin, auth, requirePermission('admin'), requireRateLimit('app-update', 4, 30 * 60 * 1000), async (req, res) => {
  const currentBranch = await appBranch();
  const settings = await loadSettings();
  const override = String(req.body?.updateChannel || '').trim().toLowerCase();
  const { branch } = UPDATE_CHANNELS.has(override)
    ? updateTargetForChannel(override, currentBranch)
    : updateTargetFromSettings(settings, currentBranch);
  const scriptPath = path.join(ROOT, 'scripts', 'install.sh');
  if (!fssync.existsSync(scriptPath)) {
    return res.status(500).json({ error: 'Installer script not found.' });
  }
  const child = spawn('bash', [scriptPath], {
    cwd: ROOT,
    env: { ...process.env, CADDYUI_BRANCH: branch, CADDYUI_ASSUME_YES: '1' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  res.json({ ok: true, started: true });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(ROOT, 'dist');
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

loadSettings().catch(() => {});

// Avoid binding the production HTTP port when the module is imported by
// the test runner. Vitest sets `process.env.VITEST`; the `import.meta.vitest`
// guard covers any future runner that may not set the env var.
const isRunningUnderVitest = process.env.VITEST === 'true' || Boolean(import.meta.vitest);

export { probeTarget, tcpCheck, checkProxyHealth, appUpdateStatus, setRunForTests };

if (!isRunningUnderVitest) {
  app.listen(PORT, () => {
    console.log(`CaddyUI API listening on :${PORT}`);
  });
}
