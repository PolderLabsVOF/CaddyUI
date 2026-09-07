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



## What you get

- Manage reverse proxies from the UI
- Add, edit, enable, disable, and delete proxy entries
- Create and manage Caddy snippets/middlewares
- Monaco-powered editors for raw config and entries
- Validate your config with `caddy validate`
- Reload Caddy after changes
- View logs from files and `journalctl`
- Built-in user authentication
- Role-based access: `view`, `edit`, and `admin`
- Security settings: trusted proxy hops, cookie mode, setup exposure, allowed origins
- Config apply via Caddy Admin API (push to `/load` and `/adapt`)
- Durable API-mode setup: the installer uses `caddy-api.service` (or warns when it is unavailable), so a reboot resumes the configuration managed by CaddyUI
- TLS dashboard with live certificate handshakes, expiry/issuer details, and global ACME settings
- Onboarding with Caddyfile and log discovery
- Self-updates from `stable`, `beta`, or `dev`

## How it works

CaddyUI reads your configured Caddy config, parses your sites, proxies, and imports, then shows them in a web interface.

When you apply changes:
- CaddyUI pushes the generated config to Caddy's Admin API (`/load`) and keeps a working config cache for the editor.

For API-managed installations, Caddy itself must start with `--resume`. The installer enables the distribution-provided `caddy-api.service` when available. Do not later run `caddy reload --config /etc/caddy/Caddyfile`: that loads file-managed configuration and replaces the API-managed one.

It also handles onboarding, authentication, user roles, log discovery, update channel selection, and runtime security settings.

CaddyUI exposes an authenticated Caddy API bridge under `/api/caddy/*`:
- `POST /api/caddy/load`, `POST /api/caddy/adapt`, `POST /api/caddy/stop`
- `GET|POST|PUT|PATCH|DELETE /api/caddy/config[/{path}]`
- `GET|POST|PUT|PATCH|DELETE /api/caddy/id/:id[/{path}]`
- `GET /api/caddy/pki/ca/:id`, `GET /api/caddy/pki/ca/:id/certificates`
- `GET /api/caddy/reverse_proxy/upstreams`

## Looks like this

<p align="center">
  <img src="docs/images/screenshot.png" alt="CaddyUI screenshot" width="100%">
</p>

## Onboarding

The first-time setup walks you through:

1. Creating an admin user
2. Entering the setup token, if required
3. Connecting to Caddy's local Admin API
4. Optionally selecting a Caddyfile only as a one-time editor bootstrap source; it is never used to reload Caddy
5. Selecting detected log files or adding log paths manually

## Configure Caddy in Settings

1. Open **Settings**.
2. In **Caddy Admin API**, set `Caddy API URL` (default `http://127.0.0.1:2019`) and optional `Caddy API secret`.
3. Click **Save**.

Notes:
- Caddy API defaults can also come from `CADDY_UI_CADDY_API_URL` and `CADDY_UI_CADDY_API_TOKEN`.
- The API secret is stored server-side; the UI only reports whether one is configured.

## Security note

- In production (`NODE_ENV=production`), set `CADDY_UI_SECRET` to a strong value (at least 32 characters), or the server will refuse to start.

## UI pages

- **Proxies**  
  Manage proxy entries with grouping, search, sorting, imports, logging, tags, and categories.

- **Middlewares**  
  Create, edit, and delete reusable Caddy snippets.

- **Configuration**  
  Edit the full raw config directly (working config cache synced to Caddy's Admin API).

- **Logs**  
  View Caddy logs from configured files and `journalctl`.

- **TLS**
  Check the actual certificate served for every configured hostname, including issuer, SANs, expiry, and handshake failures. Administrators can configure the global ACME account email and directory URL. Per-site custom certificates and `tls internal` remain visible and editable in the raw configuration.

- **Settings**  
  Configure config mode (`file`/`api`), API URL/secret, paths, scans, users, passwords, update channel, and security options.

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
