# Development and release flow

This repository has three long-lived branches. Do not use them interchangeably.

| Branch | Purpose | Allowed incoming pull requests | Release type |
| --- | --- | --- | --- |
| `dev` | Active, ongoing development | Short-lived feature/fix branches | Rolling nightly build artifact |
| `beta` | Integrated release candidate testing | `dev` only | `x.y.z-beta` prerelease |
| `main` | Production/stable release | `beta` only | `x.y.z` stable release |

## Required workflow

1. Branch from `dev`: `feat/short-description`, `fix/short-description`, or `chore/short-description`.
2. Open a PR back to `dev`. Never push directly to a protected branch.
3. Promote the tested `dev` commit through a PR from `dev` to `beta`.
4. Before merging to `beta`, set `package.json`, `package-lock.json`, and `release.json` to the next `x.y.z-beta` version and update the changelog.
5. Test the beta release. Promote that exact release candidate through a PR from `beta` to `main`.
6. Before merging to `main`, remove the `-beta` suffix from the same version and finalize the changelog.

The **Verify** workflow is required on all PRs and protected branches. It installs from the lockfile, type-checks, builds, validates the installer shell syntax, and rejects an invalid channel version. The **Release** workflow creates the GitHub release and a production archive only after the branch build passes and only once per version tag.

Repository branch protection is configured on `dev`, `beta`, and `main`: a passing `verify` check, one code-owner approval, fresh approval after new commits, resolved conversations, signed commits, linear history, and no force-pushes or deletions are required. The workflow also rejects PRs whose source/target pair is outside the table above.

## Built-in updater channels

- `stable` fetches `main`.
- `beta` fetches `beta`.
- `dev` fetches the commit-addressed archive from the latest successful rolling `nightly` release.

Stable and beta compare their branch commits. Dev compares its installed commit with the `nightly` release target, so it never installs an unchecked `dev` branch tip.

## Nightly development builds

Every push to `dev` is verified. The scheduled or manually dispatched nightly workflow builds a source archive only after type checking, production build, and installer syntax validation have passed. It uploads an immutable archive named for the checked-out `dev` commit, then advances the rolling prerelease tag `nightly` to that same commit. The archive contains a commit manifest and GitHub’s SHA-256 asset digest is required before the updater installs it.
