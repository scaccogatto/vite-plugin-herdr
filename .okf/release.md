---
type: Runbook
title: Release versioning and publication
description: Conventional Commits, SemVer tags, npm publish with provenance, GitHub Actions
tags: [release, versioning, npm, conventional-commits]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
sources:
  - resource: ../CHANGELOG.md
---

## Versioning

Semantic Versioning: MAJOR.MINOR.PATCH. Starting 0.1.0 (v0 API stable). Bump:
- PATCH: bug fixes, internal refactors
- MINOR: new features, v0.5 benchmark results, new v1+ capabilities
- MAJOR: breaking changes to plugin API or payload format

## Commits

Conventional Commits: `<type>(<scope>): <subject>` plus optional body and footer.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
Scope: optional (e.g., `client`, `server`, `payload`, `benchmark`).
Subject: imperative mood, lowercase, no period.

Example: `feat(client): add outline on picked element`

## Changelog

Manual entries in `CHANGELOG.md` under `[Unreleased]` sections (Features, Bug Fixes, Build / Tooling). On release, move to new version section with date.

## Release Process

1. Update version in `package.json` (e.g., `0.1.0`).
2. Update `CHANGELOG.md`: move `[Unreleased]` items to `## [0.1.0] - 2026-09-15`.
3. Commit: `git add package.json CHANGELOG.md && git commit -m "chore: release 0.1.0"`.
4. Tag: `git tag v0.1.0 && git push --tags`.
5. `.github/workflows/release.yml` fires on the `v*` tag push (or manual `workflow_dispatch`): `npm ci`, `npm run build`, then `npm publish --provenance`. The job requests `id-token: write` and uses no `NPM_TOKEN` secret: publish auth is npm trusted publishing over GitHub OIDC, which requires the npm package to have this repo/workflow registered as a trusted publisher on npmjs.com before the first release. If trusted publishing isn't configured yet, the fallback is an `NPM_TOKEN` secret and `npm publish --provenance` with the token in `NODE_AUTH_TOKEN`, swapped in the same step.

## Check Before Publish

- `npm run lint`, `npm run typecheck`, `npm run coverage`, `npm run build` all green.
- No uncommitted changes.
- Tag matches version in `package.json`.

Workflow guard: before publishing, the job runs `npm view <name>@<version>` and skips the publish step entirely if that version already exists on the registry, so a re-run or a duplicate tag push can't fail loudly or double-publish.
