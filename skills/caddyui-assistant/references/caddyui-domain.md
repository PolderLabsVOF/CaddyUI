# CaddyUI domain and architecture

## Product model

CaddyUI is an authenticated web control plane for a running Caddy instance. Current installations are API-managed:

```text
browser -> CaddyUI server -> Caddy Admin API -> live Caddy JSON config
                      |-> logs and journal
                      |-> TLS probes and PKI endpoints
                      `-> update installer
```

- The browser does not connect directly to Caddy's Admin API.
- CaddyUI stores sensitive provider and Caddy credentials server-side and exposes only configured/not-configured state to the browser.
- Caddy must start with `caddy run --resume` (normally through `caddy-api.service`) so API-applied configuration survives restart.
- Starting the ordinary file-managed `caddy.service` with `--config /etc/caddy/Caddyfile` can overwrite API-managed runtime state. Do not recommend it for an API-managed installation.
- A Caddyfile can be used as a one-time bootstrap/round-trip representation for the proxy-focused interface. The Runtime page controls native Caddy JSON directly.

## UI areas

- **Proxies**: create, search, group, enable/disable, inspect, and edit reverse-proxy routes.
- **Middlewares**: manage reusable Caddyfile snippets/imports.
- **Runtime**: inspect and mutate live Caddy JSON paths, servers, apps, protocols, lifecycle, metrics, upstream state, TLS/ECH, local PKI, and module configuration.
- **TLS**: certificate inventory and handshake state, expiry, issuer/SAN details, global ACME defaults, local CAs, and Caddy automation status.
- **Logs**: configured files, Caddy journal output, filtering, and operational events.
- **Settings**: Admin API connection, AI provider, proxy/cookie security, appearance, accounts, update channel, and guarded reset actions.

## Roles and trust boundaries

- `view`: read access and assistant conversations.
- `edit`: view capabilities plus proxy mutations, validation, and reload proposals.
- `admin`: edit capabilities plus users, secrets, security, AI, updates, and destructive application settings.
- Conversation ownership is per username. Pending actions are tied to the conversation and username, expire, and are single-use.
- A pending proxy action includes a server-generated configuration fingerprint. Confirmation must fail if the configuration changed after the proposal.

The supplied model context is already scoped and minimized. Do not ask for broader config, secrets, or filesystem access. A missing item means it is unavailable, out of scope, or not represented by the current proxy parser.

## Configuration representations

Caddy's authoritative runtime is JSON at the Admin API. CaddyUI also maintains a proxy-oriented text representation for its simple proxy tools. These are not interchangeable in every case:

- Use proxy proposal tools only for the simple site/proxy contract they expose.
- Direct users to Runtime for arbitrary JSON modules, complex route trees, apps, storage, logging cores, layer-4 modules, or third-party module fields.
- Do not invent Caddyfile directives or JSON fields. If exact syntax is uncertain, state that it must be checked against documentation for the installed Caddy version/modules.

## Update channels

- `stable` tracks verified releases from `main`.
- `beta` tracks prereleases from `beta`.
- `dev` installs the latest successful rolling `nightly` artifact for the verified `dev` commit, not an unchecked branch tip.

An update can temporarily leave the old frontend in a browser cache while the service has already restarted. Version verification should query the restarted backend and then reload the frontend asset manifest with cache bypassing. Do not tell users an update succeeded solely because the installer process exited zero.

