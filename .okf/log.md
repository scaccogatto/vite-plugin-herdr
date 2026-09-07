# Update Log

## 2026-09-07

Creation: bundle scaffolded with draft concepts. Milestone v0 foundation: picker, clipboard fallback, test suite. Architecture, payload, protocol, and security concepts capture the decision record.

## 2026-09-07

Docs: README, docs/, PRODUCT.md written; concepts refined. All six concept files gained a `sources` field pointing at the docs/README/PRODUCT.md files they draw from. Architecture concept got the full 8-module table. Herdr Protocol concept got explicit request/response/error framing, the full method list (including v2-reserved methods), and the observed error-code list. Security concept got the "why no token" reasoning. Benchmark concept got the per-copy CLAUDE.md detail and the judge rubric. Release concept got the actual OIDC trusted-publishing mechanism read from `.github/workflows/release.yml`, plus its NPM_TOKEN fallback. `index.md` now points to the narrative docs each concept distills.
