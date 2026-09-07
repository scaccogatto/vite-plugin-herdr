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
4. **The release workflow does the rest.** `.github/workflows/release.yml` fires on the `v*` tag push (or a manual `workflow_dispatch`): `npm ci`, `npm run build`, then `npm publish --provenance` with `id-token: write`. Auth comes from the `NPM_TOKEN` repository secret, wired into the publish step as `NODE_AUTH_TOKEN`; provenance is attested over GitHub OIDC either way.
5. **Bootstrap, one-time and by hand.** npm's trusted publishing is configured from the package's settings page on npmjs.com, so it needs the package to exist first; the first release therefore goes through a token:
   - On npmjs.com: Access Tokens, Generate New Token, Granular Access Token, packages and scopes read and write, with 2FA bypass so CI can use it, short expiry (a week is enough).
   - Store it without it ever touching a shell history or a chat: copy it, then `gh secret set NPM_TOKEN --body "$(pbpaste)"` from the repo.
   - Push the tag (step 3). The workflow publishes `0.1.0` with provenance.
   - Then switch to trusted publishing: on npmjs.com, package `vite-plugin-herdr`, Settings, Trusted Publisher, GitHub Actions, organization or user `scaccogatto`, repository `vite-plugin-herdr`, workflow filename `release.yml`, no environment. Delete the `NPM_TOKEN` secret (`gh secret delete NPM_TOKEN`), revoke the token on npmjs.com, and remove the `env` block from the publish step in `release.yml`: from then on OIDC alone authenticates and no secret exists anywhere.
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
