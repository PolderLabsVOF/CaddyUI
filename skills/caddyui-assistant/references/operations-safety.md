# Operations, TLS, and diagnostic safety

## Evidence hierarchy

Use evidence in this order:

1. Current tool result or supplied runtime status.
2. CaddyUI event/update status produced by the server.
3. Caddy logs or journal entries with timestamps.
4. TLS handshake/certificate probe results.
5. Client or Cloudflare error code and timing.
6. Configuration-based inference.

Keep facts and inferences separate. A healthy process does not prove a route, certificate, DNS record, firewall path, or upstream is healthy.

## Layered diagnosis

For public request failures, isolate the path:

```text
client -> DNS/Cloudflare edge -> origin TLS -> Caddy listener/route -> upstream service
```

- **DNS/edge**: confirm the hostname points to the intended Cloudflare record and whether proxying is enabled.
- **Origin TLS**: confirm Cloudflare SSL mode agrees with the certificate served by Caddy. Strict mode requires a certificate valid for the requested hostname.
- **Caddy route**: confirm the host exists in live config and Caddy accepted the latest load.
- **Upstream**: confirm address, port, scheme, reachability, response time, and whether its own TLS trust is valid.

Cloudflare 52x errors are symptoms, not diagnoses. A 522/524-style timeout usually indicates edge-to-origin connection or response delay; prove which hop stalled using Caddy access logs and upstream checks. Caddy proxy timeouts do not extend Cloudflare's external limits.

## TLS and ACME

- Automatic HTTPS is normally driven by site addresses and Caddy automation policy. Do not recommend manually issuing a certificate unless automation cannot express the requirement.
- HTTP-01 requires the public challenge path to reach Caddy. Cloudflare proxying can work, but redirects, firewall rules, competing origins, or stale DNS can break authorization.
- DNS-01 requires the matching DNS provider module and credential. Never request the credential in chat.
- A Cloudflare Origin CA certificate is trusted by Cloudflare, not ordinary browsers. It is appropriate only when traffic always traverses Cloudflare and SSL mode is Full (strict).
- `tls_insecure_skip_verify` disables upstream certificate verification and should be treated as a last-resort temporary exception, never a routine fix.
- Let's Encrypt authorization rate limits are external. Repeated retries before fixing DNS/routing make recovery slower. Use staging while testing uncertain challenge setups.
- OCSP warnings for a Cloudflare Origin certificate can be expected when the issuer does not publish an OCSP URL; distinguish warnings from handshake failure.

## Admin API durability

For API-managed Caddy:

- The intended systemd unit uses `caddy run --environ --resume`.
- Do not delete the only recovery copy of live config without a verified backup.
- Do not reload from `/etc/caddy/Caddyfile` after API changes; that replaces runtime state.
- Validate before applying a broad Runtime mutation. Use path ETags/conditional updates where available to prevent lost changes.

## Secrets and sensitive output

Never reveal or echo:

- Caddy API tokens or Authorization headers
- AI provider keys
- session cookies, JWTs, signing secrets, setup tokens
- TLS private keys, DNS API credentials, environment secret values
- full raw configuration or logs containing credentials

If a secret appeared in chat, logs, or a public issue, advise revocation and rotation. Redaction does not undo exposure.

## Safe failure behavior

- If data is missing, say what cannot be verified.
- If a tool returns an error, report its concise safe message and do not claim partial success.
- If config changed since proposal creation, prepare a fresh proposal after rereading context.
- If the request needs an unsupported operation, direct the user to the correct CaddyUI page and explain the minimal fields to inspect.
- Do not recommend destructive resets, disabling TLS verification, opening the Admin API publicly, or bypassing authentication as generic troubleshooting steps.

