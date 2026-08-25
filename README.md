<!-- <p align="center">
  <img src="docs/images/logo.svg" alt="CaddyUI logo" width="96" height="96">
</p> -->

# CaddyUI

```text
__| |___________________________________________________________| |__
__   ___________________________________________________________   __
  | |                                                           | |  
  | |                                                           | |  
  | |    ██████╗ █████╗ ██████╗ ██████╗ ██╗   ██╗██╗   ██╗██╗   | |  
  | |   ██╔════╝██╔══██╗██╔══██╗██╔══██╗╚██╗ ██╔╝██║   ██║██║   | |  
  | |   ██║     ███████║██║  ██║██║  ██║ ╚████╔╝ ██║   ██║██║   | |  
  | |   ██║     ██╔══██║██║  ██║██║  ██║  ╚██╔╝  ██║   ██║██║   | |  
  | |   ╚██████╗██║  ██║██████╔╝██████╔╝   ██║   ╚██████╔╝██║   | |  
  | |    ╚═════╝╚═╝  ╚═╝╚═════╝ ╚═════╝    ╚═╝    ╚═════╝ ╚═╝   | |  
  | |                                                           | |  
__| |___________________________________________________________| |__
__   ___________________________________________________________   __
  | |                                                           | |          
```

A friendly web UI for managing your Caddyfile, proxies, snippets, logs, users, and updates.

Because editing reverse proxy configs by hand is fun right up until it is not.

[![Stable release](https://img.shields.io/github/v/tag/DrB0rk/CaddyUI?filter=v*&label=stable&sort=semver)](https://github.com/DrB0rk/CaddyUI/releases/latest)
[![Beta tag](https://img.shields.io/github/v/tag/DrB0rk/CaddyUI?filter=B_v*&label=beta&color=8b5cf6&sort=semver)](https://github.com/DrB0rk/CaddyUI/releases)
[![Last commit](https://img.shields.io/github/last-commit/DrB0rk/CaddyUI)](https://github.com/DrB0rk/CaddyUI/commits)
[![Stars](https://img.shields.io/github/stars/DrB0rk/CaddyUI?style=flat)](https://github.com/DrB0rk/CaddyUI/stargazers)


## Quick install

### paste this into your caddy machine for a guided install:

```bash
curl -fsSL https://raw.githubusercontent.com/DrB0rk/CaddyUI/main/scripts/install.sh | bash
```


When the installer finishes, it prints your onboarding URL.

Run the same command again later to update CaddyUI.


## Active development warning

CaddyUI is under active development. Things move quickly, and some parts may still change between versions.

Release channels:

- `main` is the stable release lane
- `beta` is for pre-release testing
- `dev` gets the newest changes first and may be less predictable

Use `stable` if you want the calm path. Use `beta` or `dev` if you want newer features and do not mind the occasional sharp edge.


### Stable

```bash
curl -fsSL https://raw.githubusercontent.com/DrB0rk/CaddyUI/main/scripts/install.sh | bash
```

### Beta

```bash
curl -fsSL https://raw.githubusercontent.com/DrB0rk/CaddyUI/beta/scripts/install.sh | bash
```

### Dev

```bash
curl -fsSL https://raw.githubusercontent.com/DrB0rk/CaddyUI/dev/scripts/install.sh | bash
```

When the installer finishes, it prints your onboarding URL.

Run the same command again later to update CaddyUI.

> Beta and dev builds may show `-beta`, `-dev`, or date-patch suffixes like `+18052026-1`. That is expected.

## What you get

- Manage reverse proxies from the UI
- Add, edit, enable, disable, and delete proxy entries
- Group proxies by domain or category, with independent sorting per section
- Keep advanced/raw Caddy entries visible in the main proxy dashboard, with raw editing when needed
- Create reusable proxy templates and apply them while creating new proxies
- Build templates from scratch or from an existing proxy
- Create and manage Caddy snippets/middlewares
- Use a larger middleware workbench with templates, helpers, preview, duplicate, and copy-import actions
- Monaco-powered editors for raw config and entries
- Validate your config with `caddy validate`
- Reload Caddy after changes
- View logs from files and `journalctl`
- Review a structured event log with actor tracking and notification deep-links
- Built-in user authentication
- Role-based access: `view`, `edit`, and `admin`
- Scoped editor access by allowed domain and/or category
- Security settings: trusted proxy hops, cookie mode, setup exposure, allowed origins
- Appearance settings: dark/light mode plus theme accent color selection
- Config apply modes: file mode (write Caddyfile) or API mode (push via Caddy Admin API)
- Authenticated Caddy Admin API bridge for validation, load, config/id paths, PKI, upstreams, and stop
- Onboarding with Caddyfile and log discovery
- Docker sandbox for local beta testing with live-mounted source, Caddy, sample configs, logs, and Caddy API access
- Self-updates from `stable`, `beta`, or `dev`
- Date-based patch releases for fast fixes without bumping the base semver every time

## How it works

CaddyUI reads your configured Caddy config, parses your sites, proxies, and imports, then shows them in a web interface.

When you apply changes:
- In `file` mode, CaddyUI writes to your configured `Caddyfile`, validates the result with `caddy validate`, and can reload Caddy.
- In `api` mode, CaddyUI pushes config through the Caddy Admin API and keeps a working config cache for the editor.

It also handles onboarding, authentication, user roles, log discovery, update channel selection, and runtime security settings.

Scoped users can be limited to specific domains and/or categories. Scoped editors can manage matching proxies, but they cannot edit global configuration, middlewares, connection settings, security settings, or shared template definitions.

Proxy templates are stored in CaddyUI settings. Admins and unscoped editors can create and manage templates; editors can use templates when creating proxies.

In API mode, CaddyUI exposes an authenticated Caddy API bridge under `/api/caddy/*`:
- `POST /api/caddy/load`, `POST /api/caddy/adapt`, `POST /api/caddy/stop`
- `GET|POST|PUT|PATCH|DELETE /api/caddy/config[/{path}]`
- `GET|POST|PUT|PATCH|DELETE /api/caddy/id/:id[/{path}]`
- `GET /api/caddy/pki/ca/:id`, `GET /api/caddy/pki/ca/:id/certificates`
- `GET /api/caddy/reverse_proxy/upstreams`

## Versioning and patches

CaddyUI tracks a normal release version in `package.json` and an optional patch label in `release.json`.

That means a build can look like:

- `0.2.4-beta`
- `0.2.4-dev`
- `0.2.4-dev+18052026-1`

Date patches use `DDMMYYYY-N`, where `N` is the patch number for that day.

Use this when you want to ship a small fix on `beta` or `dev` without inventing a brand-new semver:

```bash
npm run release:patch
```

The updater UI recognizes these patch builds and will show the full display version instead of only the base semver.

## Docker sandbox

For local beta testing, use the Docker sandbox. It creates a separate ignored folder under `.tmp/docker-test-env`, installs Caddy in the container, live-mounts this project into `/workspace`, starts the local CaddyUI source, and bootstraps a test admin account.

```bash
scripts/docker-sandbox.sh up
```

Default URLs:

- UI through Vite: `http://127.0.0.1:5173`
- CaddyUI API/server: `http://127.0.0.1:8787`
- Test Caddy site: `http://127.0.0.1:8080`
- Caddy Admin API: `http://127.0.0.1:2019`

Default login:

- username: `admin`
- password: `adminpass123!`

Useful commands:

```bash
scripts/docker-sandbox.sh status
scripts/docker-sandbox.sh logs
scripts/docker-sandbox.sh down
scripts/docker-sandbox.sh reset
```

Environment overrides:

- `CADDYUI_SANDBOX_DIR`
- `CADDYUI_SANDBOX_STACK`
- `CADDYUI_SANDBOX_UI_PORT`
- `CADDYUI_SANDBOX_API_PORT`
- `CADDYUI_SANDBOX_HTTP_PORT`
- `CADDYUI_SANDBOX_ADMIN_PORT`
- `CADDYUI_SANDBOX_ADMIN_USER`
- `CADDYUI_SANDBOX_ADMIN_PASSWORD`
- `CADDYUI_SANDBOX_SECRET`

The generated sandbox Caddyfile is at `.tmp/docker-test-env/Caddyfile.test`. It includes examples for snippets, local upstreams, reverse proxy load balancing, host-based routes, redirects, internal TLS, matchers, rewrites, static files, and method/path matchers.

## Looks like this

<p align="center">
  <img src="docs/images/screenshot.png" alt="CaddyUI screenshot" width="100%">
</p>

## Onboarding

The first-time setup walks you through:

1. Creating an admin user
2. Entering the setup token, if required
3. Choosing file mode or API mode
4. Selecting a detected Caddyfile or entering a path manually
5. Entering the Caddy Admin API URL and optional secret for API mode
6. Selecting detected log files or adding log paths manually

## Switch config mode in Settings

1. Open **Settings**.
2. In **Caddy configuration**, set **Config mode** to `file` or `api`.
3. For `file` mode, set a readable/writable `Caddyfile path`.
4. For `api` mode, set `Caddy API URL` (default `http://127.0.0.1:2019`) and optional `Caddy API secret`.
5. Click **Save**.

Notes:
- In API mode, Caddy API defaults can also come from `CADDY_UI_CADDY_API_URL` and `CADDY_UI_CADDY_API_TOKEN`.
- The API secret is stored server-side; the UI only reports whether one is configured.
- Connection, Caddy API secret, security, user, update, and danger/recovery settings require `admin`.

## Users and scoped access

CaddyUI has three roles:

- `view`: can sign in and inspect allowed UI data.
- `edit`: can create and modify proxies and other editable surfaces.
- `admin`: can manage users, settings, updates, security controls, and recovery actions.

Editors can also be scoped with:

- Allowed domains, for example `example.com` or `*.example.com`
- Allowed categories, for example `team-a` or `staging`

When an editor has domain or category scopes, CaddyUI treats that account as scoped. Scoped editors can only mutate matching proxies. They cannot access raw config editing, middleware mutation, shared template management, Caddy connection settings, Caddy API test controls, or security settings.

## Templates

Open **Templates** to create reusable proxy presets. A template can include:

- host
- upstream
- category
- tags
- middleware imports
- logging mode and log path
- description

Templates can be created from scratch or populated from an existing proxy. On the **Proxies** page, choose a template in the create-proxy form to prefill the new proxy.

## Appearance

Open **Settings** -> **Appearance** to set browser-local display preferences:

- Dark or light mode
- Accent color: violet, cyan, emerald, amber, or rose

## Security note

- In production (`NODE_ENV=production`), set `CADDY_UI_SECRET` to a strong value (at least 32 characters), or the server will refuse to start.
- CaddyUI uses HTTP-only same-site cookies, origin checks on write actions, rate limits on sensitive actions, a bounded log-path allowlist, and production security headers.
- The Caddy Admin API bridge is authenticated and permission-checked. Mutating bridge routes require edit access and scoped editors are blocked from raw/global mutations.
- The server only accepts `http` and `https` Caddy API URLs.

## UI pages

- **Proxies**  
  Manage proxy entries with grouping, search, independent section sorting, imports, logging, tags, categories, templates, and inline advanced-entry visibility.

- **Templates**
  Create, edit, delete, search, and apply reusable proxy presets. Templates can be loaded from existing proxies.

- **Middlewares**  
  Create, edit, duplicate, preview, and organize reusable Caddy snippets with templates and helper inserts.

- **Configuration**  
  Edit the full raw config directly (from `Caddyfile` in file mode, or working config cache in API mode).

- **Logs**  
  View Caddy logs from configured files and `journalctl`, plus a structured event log for UI/API actions.

- **Settings**  
  Configure config mode (`file`/`api`), API URL/secret, paths, scans, users, scoped access, passwords, appearance, update channel, security options, and recovery actions.

## Reverse proxy example

```caddyfile
caddyui.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

## Links

- Repo: https://github.com/DrB0rk/CaddyUI
- Releases: https://github.com/DrB0rk/CaddyUI/releases
- Issues: https://github.com/DrB0rk/CaddyUI/issues
- Security policy: https://github.com/DrB0rk/CaddyUI/blob/main/docs/SECURITY.md
- Contributing: https://github.com/DrB0rk/CaddyUI/blob/main/docs/CONTRIBUTING.md
- Stable installer: https://raw.githubusercontent.com/DrB0rk/CaddyUI/main/scripts/install.sh
- Beta installer: https://raw.githubusercontent.com/DrB0rk/CaddyUI/beta/scripts/install.sh
- Dev installer: https://raw.githubusercontent.com/DrB0rk/CaddyUI/dev/scripts/install.sh

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/DrB0rk/CaddyUI/main/scripts/uninstall.sh | bash
```

## Reset onboarding

```bash
sudo rm -rf /var/lib/caddyui
sudo systemctl restart caddyui
```
