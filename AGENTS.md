# Repository agent instructions

## Branches

- Work on `dev` for active development.
- Promote the verified `dev` commit to `beta`, then the tested release candidate to `main`.
- Do not mix stable, beta, and nightly version semantics. Follow `docs/DEVELOPMENT.md`.

## Built-in AI assistant

For every task that changes, reviews, or diagnoses the built-in AI assistant, first read:

1. `skills/caddyui-assistant/SKILL.md`
2. Every file in `skills/caddyui-assistant/references/`

The runtime must continue loading this skill on every provider request through `server/assistantSkill.js`. Never replace it with an optional UI toggle or rely only on model memory. Keep raw Caddy configuration and secrets out of provider context, keep mutations confirmation-gated, and add tests whenever the tool or prompt contract changes.

