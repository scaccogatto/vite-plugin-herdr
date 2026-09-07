---
type: Runbook
title: Release versioning and publication
description: Conventional Commits, SemVer tags, npm publish with provenance, GitHub Actions
tags: [release, versioning, npm, conventional-commits]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
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
5. GitHub Actions (`.github/workflows/release.yml`) picks up tag, runs `npm run build`, publishes to npm with provenance (no explicit auth needed via `npm publish --provenance`; GitHub OIDC).

## Check Before Publish

- `npm run lint`, `npm run typecheck`, `npm run coverage`, `npm run build` all green.
- No uncommitted changes.
- Tag matches version in `package.json`.

Workflow guards: version check (`npm view`) prevents duplicate publish.
