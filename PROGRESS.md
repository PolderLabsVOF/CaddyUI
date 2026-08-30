# PROGRESS.md — CaddyUI Cross-Session State

> Canonical current-work record for the `caddy-ui` project.
> Update before and after each logical implementation pass on `beta`.

---

## Passing — Proxies table overhaul (commits 1dcd023..05be9cc, beta)

`src/pages/Proxies.jsx`, `src/components/common.jsx`, and the `server/` health-check
endpoints were reworked across six merge waves to ship a polished bulk-operations
table with live health polling. Phase 1 fixed the React #310 guard ordering
(`66fc7a2`); Phase 2 dropped the private-IP gate from `probeTarget` (`61f8cac`);
Phase 3 collapsed row actions into a three-dot menu, locked the row to seven
columns, and pulled the checkbox out of `.proxy-row-main` (`b6f6e2b`,
`7ca5f8f`, `e482346`); Phase 4 added 30s health polling inside `<Proxies>`,
gated `/api/config?health=1` behind the view permission, and wired
`onHealthPatch` optimistic updates (`9560c66`, `c87ff3e`, `e951692`);
Phase 5 shipped multi-select, the select-all header, and the bulk action
bar with `bulk-disabled` / `bulk-delete` server endpoints (`0a0b9f8`,
`7572b30`); Phase 6 closed the loop with per-site meta cleanup in
`bulk-delete` (single-write invariants, rate limits) (`5339221`) and the
14-test vitest suite covering `ProxyRow`, the bulk page, health wiring,
`checkProxyHealth`, and `probeTarget` (`a00d021`, `2b95fd1`, `11c8598`).
The `@linda` audit reported three responsive-breakpoint drift fixes that
folded into the same final merge (`05be9cc`).

### Phase ledger

| Phase | Subject | Commit(s) | Outcome |
|-------|---------|-----------|---------|
| 1 | React #310 guard-before-hooks fix (`MiddlewarePicker`) | `66fc7a2`, `9ea0db5` | passing |
| 2 | `probeTarget` health-check fix (drop private-IP gate, drop public-domain probe) | `61f8cac` | passing |
| 3 | Three-dot row menu, 7-column grid, checkbox moved out of `.proxy-row-main`, 960px breakpoint collapse | `b6f6e2b`, `7ca5f8f`, `e482346` | passing |
| 4 | 30s health polling in `<Proxies>`; `/api/config?health=1`; `onHealthPatch` wiring; view-permission + rate-limit gate | `9560c66`, `c87ff3e`, `e951692` | passing |
| 5 | Multi-select, select-all header, bulk action bar (`bulk-disabled`, `bulk-delete` endpoints) | `0a0b9f8`, `7572b30` | passing |
| 6 | Per-site meta cleanup in `bulk-delete` (single-write invariants, rate limits); 14 vitest tests; `@linda` responsive-breakpoint fixes | `a00d021`, `2b95fd1`, `5339221`, `11c8598`, `f0348b9`, `05be9cc` | passing |

### Acceptance evidence

- `npm test` — 14/14 vitest cases pass across `src/__tests__/{components,pages,server,wiring}/` (5 files: `ProxyRow.test.jsx`, `Proxies.bulk.test.jsx`, `checkProxyHealth.test.js`, `probeTarget.test.js`, `HealthPolling.test.jsx`).
- `npm run typecheck` — `tsc --noEmit` clean.
- `npm run build` — `vite build` clean (`dist/index.html`, `dist/assets/index-*.css` 53.18 kB, `dist/assets/index-*.js` 331.89 kB).
- `@linda` audit — clean after three responsive-breakpoint fixes folded into merge `05be9cc`.
- Meta-cleanup parity — `bulk-delete` and the single-row delete path both honour the per-site `meta.json` single-write invariant; rate-limit middleware is shared between `bulk-disabled` and the existing toggle endpoint.

### Outstanding before release

1. E2E verification by `@kevin` against the merged beta tree (browser-driven smoke of the bulk action bar + health polling cadence).
2. Push `beta` to `origin/beta`.
3. Tag and publish `v0.2.11-beta` (next bump after the `v0.2.10-beta` already shipped via `58fcc25`).
