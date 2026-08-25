# Security Policy

If you found a security issue in CaddyUI, please report it privately.

## How to report

- Open a private security advisory in GitHub:  
  https://github.com/DrB0rk/CaddyUI/security/advisories/new

Include:
- affected version/commit
- reproduction steps
- impact
- suggested fix (if you have one)

Please do not publish the issue publicly before a fix is available.

## Security model overview

CaddyUI is designed to be run behind your own trusted network boundary or reverse proxy. In production, always set `CADDY_UI_SECRET` to a strong value of at least 32 characters. The server refuses to start in production with the default secret.

Key controls:

- HTTP-only, same-site auth cookie.
- Signed sessions with a required production secret.
- Origin checks on write actions.
- Rate limiting on login, setup, user management, template management, updates, Caddy API tests, reset actions, password changes, and Caddy stop.
- Bounded log-path allowlist.
- Security headers including CSP, frame denial, no-sniff, referrer policy, permissions policy, COOP, CORP, DNS prefetch off, and cross-domain policy denial.
- Admin-only settings for Caddy connection details, security settings, users, updates, and recovery actions.
- Scoped editor support for domain/category-limited proxy mutation.

## Roles and scoped editors

Roles:

- `view`: read-only access.
- `edit`: proxy/config editing access.
- `admin`: full administrative access.

Editors can be scoped by allowed domains and/or categories. Once scoped, an editor can mutate only matching proxies. Scoped editors are blocked from raw config editing, middleware mutation, shared template management, Caddy connection settings, Caddy API test controls, security settings, updates, user management, and recovery actions.

## Caddy Admin API bridge

When API mode is enabled, CaddyUI can talk to the configured Caddy Admin API. CaddyUI only accepts `http` and `https` Caddy API URLs, stores optional API secrets server-side, and requires authentication plus permissions for bridge routes.

Mutating raw Caddy Admin API bridge routes require edit access and are blocked for scoped editors. Caddy connection changes and API connection tests require `admin`.

## Docker sandbox

The Docker sandbox is intended for local testing only. It creates files under `.tmp/docker-test-env`, uses a default admin password, exposes local test ports, and enables remote setup inside the sandbox container. Do not expose the sandbox directly to an untrusted network.
