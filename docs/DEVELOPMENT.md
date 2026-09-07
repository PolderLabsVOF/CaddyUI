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

## Built-in updater channels

- `stable` fetches `main`.
- `beta` fetches `beta`.
- `dev` fetches `dev`.

The updater compares branch commits, not GitHub release tags. A release must therefore be present on the matching branch before users can see it in **Check update**.

## Nightly development builds

Every push to `dev` is verified. The nightly workflow also produces a dated development artifact from the latest `dev` commit; it is for testing only and does not create a GitHub release or mutate a version tag.
