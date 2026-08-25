# Contributing

Thanks for helping improve CaddyUI.

## Before you start

- Search existing [issues](https://github.com/DrB0rk/CaddyUI/issues) first.
- Open an issue for bugs, feature requests, or larger changes.
- Keep PRs focused and small where possible.

## Branch flow

- `dev` is the active development branch.
- Do not open feature work directly against `main`.
- Release flow is `dev` -> `beta` -> `main`.

## Local setup

```bash
git clone https://github.com/DrB0rk/CaddyUI
cd CaddyUI
npm install
npm run dev
```

## Docker sandbox

For integration testing with real Caddy installed, use the sandbox:

```bash
scripts/docker-sandbox.sh up
```

The sandbox live-mounts the local project, starts CaddyUI from the working tree, runs Caddy with a generated test Caddyfile, and bootstraps a test admin account.

Useful commands:

```bash
scripts/docker-sandbox.sh status
scripts/docker-sandbox.sh logs
scripts/docker-sandbox.sh down
scripts/docker-sandbox.sh reset
```

The sandbox directory is `.tmp/docker-test-env` by default and is ignored by git.

## Pull requests

1. Fork the repository.
2. Create a branch from `dev`.
3. Make your changes.
4. Run:
   ```bash
   npm run typecheck
   npm run build
   ```
5. Open a PR to `dev` and fill out the PR template.

Please follow [Conventional Commits](https://www.conventionalcommits.org/).
