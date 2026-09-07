# Changelog

All notable changes to this project are documented here. Conventional Commits; a release is a `v*` tag, published from CI over npm trusted publishing.

## [Unreleased]

### Features

### Bug Fixes

### Build / Tooling

## [0.2.0] - 2026-09-07

### Features

- Popup redesign: a two-row header (selector with Open in editor, ancestors with file:line), a borderless prompt, a screenshot switch, a persistent `To` field that shows the target agent with status, branch and pane, the agent list collapsed by default (Down or a click expands it), a table list with monospace columns and colored status ticks, left accent bar selection, workspace headings with a `focused` pill, and a keycap footer with a Send button; light and dark schemes follow `prefers-color-scheme`, every text pair at 4.5:1 or better.
- Spawn actions are the last two rows of the agent list, reachable with Up/Down: select one and Enter (or Send) starts the agent, split pane or fresh worktree, then sends the prompt to it.
- Popup interactions: Tab cycles inside the dialog, Enter on a focused button activates that button, a sending state disables the form and restores focus after an error, the popup stays inside the viewport after the list grows and on resize, the picked outline follows page scroll, entry motion respects reduced motion; listbox groups with `aria-activedescendant`, tooltips on blocked rows and on long hints.

### Bug Fixes

- Multi-select boxes no longer paint above the popup; the hover chip hides over an element that is in flight; rows disabled during a spawn no longer look blocked; the in-flight chip renders right after a send instead of waiting for the first status event; long hints truncate from the start so the file name stays visible.

### Build / Tooling

- 27 new Playwright specs for the popup (53 e2e in total) and 253 unit tests; the fake herdr answers `agent.prompt` with the target's own title; the README demo GIF was re-recorded with the new popup.

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

[Unreleased]: https://github.com/scaccogatto/vite-plugin-herdr/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/scaccogatto/vite-plugin-herdr/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/scaccogatto/vite-plugin-herdr/releases/tag/v0.1.0
