---
type: Runbook
title: Release versioning and publication
description: Executable steps to cut v0.1.0 and later releases, plus Conventional Commits, SemVer, and the npm-provenance publish workflow
tags: [release, versioning, npm, conventional-commits, runbook]
generated:
  by: claude/fable-5-1
  at: 2026-09-07
status: draft
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
4. **The release workflow does the rest.** `.github/workflows/release.yml` fires on the `v*` tag push (or a manual `workflow_dispatch`): `npm ci`, `npm run build`, then `npm publish --provenance`. The job requests `id-token: write` and does not set `NODE_AUTH_TOKEN` itself, so publish auth resolves one of two ways:
   - **npm trusted publishing (recommended, no secret).** The npm package `vite-plugin-herdr` has this repo and workflow (`scaccogatto/vite-plugin-herdr`, `release.yml`) registered as a trusted publisher on npmjs.com; `npm publish --provenance` then authenticates over GitHub OIDC with nothing stored in the repo.
   - **`NPM_TOKEN` fallback.** If trusted publishing isn't configured, add an `NPM_TOKEN` repository secret (an npm automation token with publish rights to the package) and wire it into the publish step as `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.
5. **The very first publish is a chicken-and-egg step the package owner has to clear by hand.** Trusted publishing can only be registered on npmjs.com against a package that already exists (or, where npm supports it, a reserved not-yet-published name); a tag push alone cannot bootstrap either the package's existence or its trusted-publisher registration. Before the first `v0.1.0` tag push does anything useful, a maintainer with npm org access needs to either (a) register trusted publishing for `vite-plugin-herdr` on npmjs.com pointing at this repo/workflow, having first published the package once by hand or via the `NPM_TOKEN` fallback, or (b) set the `NPM_TOKEN` repository secret and rely on that path for this release and until trusted publishing is set up. This step cannot be automated or done from CI; it's a one-time human action.
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
