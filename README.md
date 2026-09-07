# CaddyUI

```text
   ______          __    __      __  ______
  / ____/___ _____/ /___/ /_  __/ / / /  _/
 / /   / __ `/ __  / __  / / / / / / // /
/ /___/ /_/ / /_/ / /_/ / /_/ / /_/ // /
\____/\__,_/\__,_/\__,_/\__, /\____/___/
                        /____/
                 a calm control plane for Caddy
```

[![Stable release](https://img.shields.io/github/v/release/PolderLabsVOF/CaddyUI?display_name=tag&label=stable)](https://github.com/PolderLabsVOF/CaddyUI/releases/latest)
[![Beta release](https://img.shields.io/github/v/release/PolderLabsVOF/CaddyUI?include_prereleases&label=beta&color=8b5cf6)](https://github.com/PolderLabsVOF/CaddyUI/releases)
[![Verify](https://github.com/PolderLabsVOF/CaddyUI/actions/workflows/verify.yml/badge.svg)](https://github.com/PolderLabsVOF/CaddyUI/actions/workflows/verify.yml)
[![License](https://img.shields.io/github/license/PolderLabsVOF/CaddyUI)](LICENSE)

CaddyUI is a self-hosted control plane for Caddy. It gives you a safer place to manage reverse proxies, reusable middleware, live configuration, TLS automation, logs, access, and updates.

The installer configures API mode: changes are validated and applied through Caddy’s Admin API, and API-managed installations survive restarts through Caddy’s `--resume` support.

> CaddyUI is under active development. Use the stable channel for production; beta and nightly builds are for testing newer work.

## Start here

Run the stable installer on the Caddy host:

```bash
curl -fsSL https://raw.githubusercontent.com/PolderLabsVOF/CaddyUI/main/scripts/install.sh | bash
```

The installer creates the service, configures API-mode Caddy where the distribution supports it, and prints a one-time onboarding URL. It resolves GitHub’s latest non-prerelease release and installs that exact stable tag—never a beta or nightly build. Run the same command again to update to the latest stable release.

<details>
<summary>Choose a release channel</summary>

| Channel | Source | Intended use | How to use it |
| --- | --- | --- | --- |
| Stable | published stable release | Production releases | `.../main/scripts/install.sh` |
| Beta | `beta` | Pre-release verification | Select it from CaddyUI after installing stable. |
| Nightly | verified `dev` artifact | Active development; may change with every verified push | Select it from CaddyUI after installing stable. |

The curl installer is intentionally stable-only. Select **Beta** or **Nightly** from CaddyUI’s in-app update channel control when you explicitly want a pre-release build.
</details>

## What you can control

| Area | What CaddyUI does |
| --- | --- |
| **Proxies** | Create, group, search, enable, and edit reverse-proxy routes. |
| **Middlewares** | Maintain reusable snippets and route-level building blocks. |
| **Runtime** | Control live apps, HTTP servers, protocols, lifecycle, metrics, upstream state, TLS/ECH, local PKI, and every JSON module path. |
| **TLS** | Triage live certificate handshakes, expiry, issuer, SANs, and ACME defaults. |
| **Logs** | Read discovered Caddy logs and `journalctl` output in one place. |
| **Access** | Manage local users and `view`, `edit`, and `admin` roles. |
| **Operations** | Validate, apply, reload, configure update channels, and monitor status. |

## How the pieces fit

```text
 Browser
    │ authenticated session
    ▼
 CaddyUI ───────────► Caddy Admin API ───────────► live Caddy config
    │                         │
    │                         └── Caddy starts with --resume
    │
    ├── certificate status checks
    ├── logs and journal output
    └── update-channel installer
```

CaddyUI’s **Runtime** page reads and writes Caddy’s native JSON directly. Its path editor supports atomic replace, create/append, insert, and delete operations with path-specific ETags to prevent lost updates. The focused forms cover HTTP/1.1, HTTP/2, H2C, HTTP/3, 0-RTT, timeouts, full duplex, and Caddy 2.11 TCP keepalive controls; the remaining stock and third-party module fields stay available through the same JSON tree.

In an API-managed installation, start Caddy with `--resume` (the installer enables the packaged `caddy-api.service` when available). Do not later load `/etc/caddy/Caddyfile` through the normal file-managed service: doing so replaces the API-managed configuration.

A Caddyfile can still be selected during onboarding as a one-time editor bootstrap source. It is not used to reload an API-managed Caddy instance.

## TLS without the scavenger hunt

The TLS page is an operational dashboard rather than a certificate dump:

- Health counters make failed, unauthorized, and near-expiry certificates visible immediately.
- Filter the inventory by state and select a hostname for certificate-level details.
- Inspect subject, issuer, validity dates, SHA-256 fingerprint, and SANs.
- Set the global ACME account email and directory URL from the same page.

Per-site certificate directives, internal PKI, and custom certificates remain part of the raw Caddy configuration. Test new DNS or Cloudflare arrangements with an ACME staging directory before switching back to the public CA.

## First-run checklist

1. Create the initial administrator in the onboarding flow.
2. Confirm CaddyUI can reach the local Caddy Admin API (normally `http://127.0.0.1:2019`).
3. Confirm Caddy is in API mode and starts with `--resume`.
4. Add or approve discovered Caddy log paths.
5. Add `CADDY_UI_SECRET` before exposing CaddyUI beyond a trusted network.
6. Configure TLS defaults, then use the TLS inventory to verify the certificates actually served.

## Configuration and security

Open **Settings → Caddy Admin API** to set the API URL and, if enabled, its API token. Environment variables can provide the same defaults:

```bash
CADDY_UI_CADDY_API_URL=http://127.0.0.1:2019
CADDY_UI_CADDY_API_TOKEN=replace-with-your-api-token
CADDY_UI_SECRET=use-a-strong-32-character-minimum-secret
```

The API token is stored server-side; the browser only learns whether one is configured. In production, CaddyUI refuses to start without a sufficiently strong `CADDY_UI_SECRET`.

CaddyUI exposes its authenticated Caddy API bridge below `/api/caddy/*`, including configuration, ID, PKI, and reverse-proxy upstream endpoints. Treat administrator access to CaddyUI as administrator access to your proxy infrastructure.

## A minimal route for CaddyUI

```caddyfile
caddyui.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Put CaddyUI behind your preferred network controls or authentication layer. If you proxy it through Cloudflare, make sure the origin’s TLS mode and Caddy certificate setup agree before enabling the proxy.

## Developing and contributing

Development happens on `dev`. Promote reviewed work through `beta`, then `main`; direct pushes and unverified changes are intentionally blocked on all protected branches: `dev`, `beta`, and `main`.

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Read the [development guide](docs/DEVELOPMENT.md) before opening a change and the [contribution guide](docs/CONTRIBUTING.md) for the review workflow. The repository also has a [security policy](docs/SECURITY.md) and [code of conduct](docs/CODE_OF_CONDUCT.md).

## Links

- [Source code](https://github.com/PolderLabsVOF/CaddyUI)
- [Releases](https://github.com/PolderLabsVOF/CaddyUI/releases)
- [Report a bug or request a feature](https://github.com/PolderLabsVOF/CaddyUI/issues)
- [Stable installer](https://raw.githubusercontent.com/PolderLabsVOF/CaddyUI/main/scripts/install.sh)

## License

CaddyUI is licensed under **GNU AGPL-3.0-only**. You may use, study, copy, modify, and redistribute it under that license. If you modify CaddyUI and make that version available to users over a network, the AGPL requires you to offer those users the corresponding source code under the same license. See [LICENSE](LICENSE) for the complete terms.

Releases and copies already received under the previous MIT license keep the rights granted by that license; the change is not retroactive.

## Uninstall or reset

```bash
curl -fsSL https://raw.githubusercontent.com/PolderLabsVOF/CaddyUI/main/scripts/uninstall.sh | bash
```

To reset only CaddyUI onboarding data (this removes local CaddyUI users and settings), stop and inspect the target before removing `/var/lib/caddyui`, then restart the service.
