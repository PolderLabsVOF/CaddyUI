# Contributing

Thanks for helping improve CaddyUI.

## Before you start

- Search existing [issues](https://github.com/DrB0rk/CaddyUI/issues) first.
- Open an issue for bugs, feature requests, or larger changes.
- Keep PRs focused and small where possible.

## Branch flow

Follow [the development and release flow](DEVELOPMENT.md). In short: feature branches target `dev`, only `dev` is promoted to `beta`, and only `beta` is promoted to `main`.

## Local setup

```bash
git clone https://github.com/DrB0rk/CaddyUI
cd CaddyUI
npm install
npm run dev
```

## Pull requests

1. Fork the repository.
2. Create a branch from `dev`.
3. Make your changes.
4. Run:
   ```bash
   npm run build
   ```
5. Open a PR to `dev` and fill out the PR template. Protected branches require a passing **Verify** check and review.

Please follow [Conventional Commits](https://www.conventionalcommits.org/).
