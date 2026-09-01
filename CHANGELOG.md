# Changelog

## 0.2.17-beta - 2026-09-01
### Fixed
- In-app update flow no longer reports "done" before the new version is actually serving requests. The old process's git state (`localCommit === remoteCommit` after `install.sh` runs `git reset --hard`) used to fire the completion check while the old process was still serving — only the new process actually restarts after that step. The frontend now also gates on a process-identity check (`processStartedVersion === installedVersion` from `/api/app/check-updates`), and only dismisses the overlay once the running process is the new build. The status response now exposes both fields so the UI can compare them.

## 0.2.16-beta - 2026-09-01
### Added
- AI assistant now mirrors the user's Caddyfile format conventions when proposing create or edit actions. The assistant context includes a `formatGuide` (indent unit + width, quote style, line endings, host naming convention), `sampleBlocks` (canonical example site blocks from the current config), `snippets` (declaed middleware snippets with bodies), and `snippetUsage` (declared / referenced / orphan). The system prompt instructs the model to match the user's indentation, quoting, and line endings, and to reuse existing snippet names rather than invent new ones.
- AI-created proxy blocks now use the user's detected indentation. `appendSimpleProxy` reads the indent unit from the current config (tab by default; otherwise the smallest common unit of 8/4/2 spaces), so newly appended site blocks match the surrounding file instead of being forced to tabs.

### Changed
- AI context payload sent to the provider is now structured and capped (60K chars total, 2400 bytes for snippet bodies) instead of being a raw `JSON.stringify` blob, so format-mirroring instructions and example blocks are guaranteed to reach the model.

## 0.2.15-beta - 2026-09-01
### Added
- AI assistant messages now render Markdown (bold, italic, inline code, fenced code blocks, ordered/unordered lists, GFM-style pipe tables, and links) via an in-house renderer in `src/components/markdown.jsx`. HTML is escaped before token substitution.
- AI assistant chat animations: scale-and-rise panel entry, hover lift + scale + glow pulse on the Sparkles trigger button, staggered fade + slide-up for messages (user messages slide in from the right, assistant from below), bouncing three-dot Thinking indicator (replaces the spinning Loader), fade + slide-up + lift for action cards, focus glow on the composer textarea, and hover/press feedback on the send button. All animations respect `prefers-reduced-motion`.

## 0.2.14-beta - 2026-09-01
### Fixed
- AI assistant popup/button is restored in the UI. The floating Sparkles trigger button and conversation panel are mounted in `App.jsx`, with required props (`api`, `settings`, `canAdmin`, `notify`, `onActionComplete`, `onOpenSettings`).
- AI backend endpoints that were dropped between `c74a521` and `43c4b4a` are restored: `GET /api/ai/status`, `GET /api/ai/conversations`, `POST /api/ai/conversations`, `GET /api/ai/conversations/:id/messages`, `DELETE /api/ai/conversations/:id`, `POST /api/ai/conversations/:id/messages`, `POST /api/ai/actions/:id/{reject,confirm}`. Helpers `summarizeText`, `eventActor`, `recordEvent`, `canUserEditProxyTarget` (plus `normalizeDomainScope`/`normalizeCategoryScope`/`domainScopeMatches`/`userHasScopedEditRestrictions`), `visibleAiProxySummaries`, `aiContextForUser`, and `aiProviderConfig` are added back to `server/index.js`.
- AI message handler now passes the conversation's existing message history, user role, and proxy context to `runAiAssistant`, so the assistant can list proxies and stage proposals (create/update/disable/delete/reload) for explicit user confirmation.

## 0.2.13-beta - 2026-09-01

### Fixed
- AI assistant settings: "Test AI provider" and saving AI credentials in Settings no longer return 404. Restored the `/api/ai/settings/test` endpoint and AI field handling in `normalizeSettings`, `publicSettings`, `statusSettings`, and `POST /api/settings` that were dropped between `c74a521` and `43c4b4a`.
- AI providers that respond with `text/event-stream` (Server-Sent Events) instead of JSON are now parsed correctly. PolderLabs, Cloudflare AI Gateway, and other streaming OpenAI-compatible gateways return the OpenAI Chat Completions schema split across SSE chunks; the assistant call path now aggregates `delta.content` chunks into the same response shape as a non-streaming reply.

## 0.2.7-beta - 2026-08-26

### Changed
- Caddy is now configured exclusively through its Admin API; the file-mode configuration path is removed from settings, server, and docs.
- Self-update flow now preserves `data/`, `.env`, `logs/`, `*.log`, and `*.pid` when running `git clean -fd`.

### Added
- Middleware picker dropdown closes when clicking outside.

## 0.2.0-dev - 2026-05-11

### Changed
- Dev branch now reports `0.2.0-dev` and installer default channel `dev`.

## 0.2.0 - 2026-05-11

### Added
- Stable release of runtime version-sync improvements and sidebar feedback shortcut.

### Changed
- Version badge updates now follow runtime status during and after updates.
- Stable installer channel default is set to `main`.

## 0.2.0-beta - 2026-05-11

### Added
- Sidebar feedback shortcut that opens GitHub issue creation.

### Changed
- Header and sidebar version badges now prefer runtime version data during update flow.
- Update completion message and UI version state are synchronized before reload.
- Beta installer channel default now points to `beta`.

## 0.1.8 - 2026-05-11

### Added
- Stable release of the latest proxy/mobile/update improvements from the beta lane.

### Changed
- Installer default channel on `main` now targets `main`.
- Tags and category metadata are stored in SQLite instead of Caddyfile comments.
- Update UX now keeps an updating screen visible until the new version is actually ready.
- Mobile proxy row layout improved for better readability and action-button access.

### Security
- Changing the configured Caddyfile path now requires `admin` permission.

## 0.1.8-beta - 2026-05-11

### Added
- Full-screen update progress overlay that stays visible until the new app version is ready.
- SQLite-backed proxy metadata table for tags and categories.

### Changed
- Tags and category are no longer written into Caddyfile comments for proxy create/edit.
- Proxy rows on mobile now use a clearer label/value layout with more reliable action button visibility.

### Fixed
- Update flow now waits for branch/commit/version readiness checks before reporting success.

## 0.1.7-beta - 2026-05-11

### Added
- Beta build with latest dev updates for proxy management, settings, and security controls.

### Changed
- README stable badge now tracks stable `v*` tags only.
- Tag autocomplete now continues suggestions after commas.
- Beta package version now reports `0.1.7-beta`.

## 0.1.5-dev - 2026-05-11

### Added
- Security settings in the Settings page:
  - trusted proxy hops
  - cookie mode (`auto`, `secure`, `insecure`)
  - allow remote first-time setup toggle
  - additional allowed origins list

### Changed
- Security-related runtime behavior now follows saved settings without requiring env-only configuration.
- Settings and status API responses now include security configuration fields.

### Security
- Editing security settings now requires `admin` permission.
- Trusted forward headers are only used when trusted proxy hops are enabled.

## 0.1.4 - 2026-05-11

### Added
- SQLite file database for settings/session state and parsed config cache.
- Proxy category support (single category per proxy).
- Proxies view mode switcher (sections by domain or by category).
- Dynamic while-typing autocomplete for proxy category and tags.

### Changed
- Proxy sorting moved to clickable table headers with direction indicators.
- Default proxy sorting set to host A-Z.
- Proxies table column naming and layout consistency updates.

### Fixed
- View selector alignment/spacing in the proxies toolbar.
- Top-level feedback visibility via fixed header popup.

## 0.1.3 - 2026-05-11

### Added
- Mobile layout with bottom navigation.
- Log source selector with `journalctl -u caddy` support.
- Settings scan buttons for Caddyfiles and log files.
- Per-proxy logging selector (`none`, `default`, `stdout`, `stderr`, `file`).

### Changed
- Frontend split into smaller page/component files.
- Middleware editor now uses automatic indentation handling.
- Installer now doubles as updater when CaddyUI is already installed.
- Script versioning separated from app versioning.

### Fixed
- Proxy action buttons clipping/disappearing on narrower displays.
- Monaco CSP/style loading and editor rendering issues.
- Proxy health state drift after proxy mutations.

### Security
- Added username format validation.
- Added password length bounds and validation consistency.
- Prevented deletion/demotion of the last admin user.
- Bounded log line query size on logs API.

## 0.1.1 - 2026-05-10

### Added
- Installer, updater, and uninstaller scripts.
- Optional Caddy reverse proxy setup during install.
- Optional proxy cleanup during uninstall.
- Setup token support for first-run account creation.
- Local test mode for frontend work.
- Proxy and middleware create, edit, and delete actions.
- Search for configured proxies.
- Proxy health checks for local upstreams.
- Raw proxy block editor inside proxy edit.

### Changed
- Split onboarding into account setup and Caddy config steps.
- Proxies view uses grouped full-width rows.
- Import selection uses a multi-select dropdown.
- Theme updated with dark/light mode and grayscale base styling.
- Header shows app version.
- Scripts print their version.

### Fixed
- Production server startup route handling.
- Proxy import placement for snippets like `pass_host_header`.
- Login flow when setup is complete but the session is missing.
- Cookie handling for direct HTTP onboarding before HTTPS proxying.
- Installer domain detection and manual domain fallback.

### Security
- Stronger cookie settings.
- Required production secret.
- Login rate limiting.
- Origin checks on write actions.
- Revocable JWT sessions.
- Log path allowlist.
- Basic CSP and security headers.
- Pinned dependency versions.
