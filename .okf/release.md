---
type: Runbook
title: Release versioning and publication
description: Executable steps to cut v0.1.0 and later releases, plus Conventional Commits, SemVer, and the npm-provenance publish workflow
tags: [release, versioning, npm, conventional-commits, runbook]
generated:
  by: claude/fable-5-1
  at: 2026-09-07
status: stable
sources:
  - resource: ../CHANGELOG.md
  - resource: ../.github/workflows/release.yml
  - resource: ../package.json
---

## Cutting a release

1. **Bump `package.json`'s `version`.** For the very first release this is already done: `package.json` is at `0.1.0` and needs no bump. For every later release, bump PATCH/MINOR/MAJOR per the rule below before doing anything else.
2. **Update `CHANGELOG.md`.** Move the `[Unreleased]` entries into a new dated section matching the version (the `[0.1.0] - 2026-09-07` section already exists for the first release). Don't tag against a changelog still carrying the new version's notes under `[Unreleased]`.
3. **Commit, tag, push the tag:**
   ```sh
   git add package.json CHANGELOG.md
   git commit -m "chore: release 0.1.0"
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. **The release workflow does the rest, without any token.** `.github/workflows/release.yml` fires on the `v*` tag push (or a manual `workflow_dispatch`): `npm ci`, `npm run build`, then `npm publish --provenance` with `id-token: write`. The workflow is registered on npmjs.com as the package's trusted publisher, so npm exchanges the GitHub OIDC identity for a short-lived publish credential; nothing is stored in the repo, in GitHub secrets or on any machine. Never add `NODE_AUTH_TOKEN` to the publish step: with a token present npm skips OIDC. Trusted publishing needs npm 11.5.1 or later, which is why the workflow installs `npm@latest` before publishing.
5. **Bootstrap, one time, by hand, no token stored anywhere.** A trusted publisher attaches to a package that already exists (npm/cli#8544 tracks first-publish support), so the first version is published from a maintainer's machine with the account's 2FA:
   - `npm login` (browser flow), then from a clean checkout of the tagged commit: `npm run build` and `npm publish` (npm asks for 2FA in the browser; without provenance, which only CI can attest).
   - On npmjs.com, package `vite-plugin-herdr`, Settings, Trusted publishing: GitHub Actions, organization or user `scaccogatto`, repository `vite-plugin-herdr`, workflow filename `release.yml`, no environment, allow `npm publish`. Then Publishing access: "Require two-factor authentication and disallow tokens", so no token can ever publish this package again.
   - `npm logout`, which deletes the login token from `~/.npmrc`.
   - Push the tag (step 3) afterwards: the workflow's version guard sees `0.1.0` already on the registry and skips the publish, so the tag only marks the release on GitHub. Every later version is published by the workflow over OIDC, with provenance.
6. **Re-running is safe.** The workflow's "Check if version is already published" step runs `npm view <name>@<version>` first and skips the publish step entirely when that version is already on the registry, so a re-run of the workflow or a duplicate tag push never double-publishes or fails loudly.

## Versioning

Semantic Versioning: MAJOR.MINOR.PATCH. Starting 0.1.0 (v0 API stable). Bump:
- PATCH: bug fixes, internal refactors
- MINOR: new features, new v1+ capabilities
- MAJOR: breaking changes to plugin API or payload format

## Commits

Conventional Commits: `<type>(<scope>): <subject>` plus optional body and footer.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
Scope: optional (e.g., `client`, `server`, `payload`, `benchmark`).
Subject: imperative mood, lowercase, no period.

Example: `feat(client): add outline on picked element`

## Changelog

Manual entries in `CHANGELOG.md` under `[Unreleased]` sections (Features, Bug Fixes, Build / Tooling). On release, move to a new dated version section.

## Check before publish

- `npm run lint`, `npm run typecheck`, `npm run coverage`, `npm run build` all green.
- No uncommitted changes.
- Tag matches `version` in `package.json`.
