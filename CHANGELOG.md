# Changelog

All notable changes to this project are documented here. Conventional Commits, releases cut with release-it.

## [Unreleased]

### Features

### Bug Fixes

### Build / Tooling

## [0.1.0] - 2026-09-07

### Features

- Picker: `ctrl+b` arms the picker, hover highlights the element with a chip showing its selector and source hint, click opens the popup near the click; Esc closes; the hotkey is configurable.
- Popup: prompt textarea, agents grouped by herdr workspace with status dots, preselection of the last agent used on this origin, then an idle agent in the dev server's own workspace; Up/Down change the agent, Enter sends, Shift+Enter inserts a newline.
- Payload: source hint (locator attributes, the Vue inspector vnode prop, the Vue runtime file, the React component name), selector path, trimmed HTML with the picked node marked, computed styles, bounding box and page URL; hints are resolved to absolute paths against the Vite root, the process cwd and the parent directory; long snippets go to a markdown file under the OS temp directory.
- Dev-server bridge: `GET /__herdr/state` and `POST /__herdr/prompt`, same-origin only, backed by herdr's Unix socket (`session.snapshot`, `agent.prompt`); blocked agents are refused with a clear toast; without herdr the same popup copies the composed prompt to the clipboard.
- In-flight outline: after a send the element stays outlined until herdr reports the agent idle, done or blocked, over Vite's HMR socket (`herdr:status`) with a polling fallback.
- Spawn: `+ agent here` splits a pane next to the dev server and starts Claude Code there, `+ agent in worktree` creates a herdr worktree workspace first (`POST /__herdr/spawn`).
- Multi-select: Shift+click adds up to five elements to one prompt, each snippet numbered in the payload.
- Screenshot, opt-in: a real-pixel capture of the picked element with its outline, taken by macOS `screencapture` from the dev server and referenced in the prompt; promoted by the pre-registered payload benchmark (visual tasks 60% to 80% success, 23% fewer turns, no gain from a bare screenshot).
- Meta-frameworks: `appendTo` appends the client import to a matching module for apps where `transformIndexHtml` does not run (Nuxt, SvelteKit).
- Demo app with a Bench view of seeded defects, and a benchmark harness (`bench/`) that captures payload variants with Playwright and scores them with headless Claude Code runs.

### Build / Tooling

- TypeScript strict, ESM only, Vite 8 library build with bundled declarations, Vitest unit and integration specs with a fake herdr socket, Playwright end-to-end specs on the real routes, GitHub Actions CI (lint, typecheck, coverage, build, e2e) and a tag-driven release with npm provenance.

[Unreleased]: https://github.com/scaccogatto/vite-plugin-herdr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/scaccogatto/vite-plugin-herdr/releases/tag/v0.1.0
