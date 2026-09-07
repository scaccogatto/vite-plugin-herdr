---
type: Architecture
title: vite-plugin-herdr module design
description: Eight source modules split between server and client, sharing pure types and composition functions
tags: [plugin, vite, client-server, modules]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: stable
sources:
  - resource: ../docs/stack.md
  - resource: ../README.md
  - resource: ../docs/payload.md
---

## System Decomposition

Eight modules organize the plugin: four on Node (server), three on DOM (client), one pure layer shared between them. `compose.ts` is the shared layer specifically because it must have no Node and no DOM imports, it runs both in the server (composing the final prompt) and, unbuilt, in clipboard-fallback code paths.

| File | Responsibility |
|---|---|
| `src/index.ts` | Plugin entry: `resolveOptions`, `VIRTUAL_ID` constant, `resolveId` mapping virtual to real client, `transformIndexHtml` injection of client `<script>`, `configureServer` mounting the three routes |
| `src/server.ts` | Socket bridge: `mountRoutes`, `getState`, `toAgentRow`, `toWorkspaceRow`, `absolutizeHint`, `postPrompt`, `validateSpawn`, `spawnAgent`, `watchAgent`, `writeAttachment`, `cleanupAttachments` (24-hour expiry for `.md` and `.png`), `screenshotAvailability(option, platform?)`, `screenRegion(shot, margin?)`, `captureScreenshot(region, file, command)` (`execFile` + `stat`, throws `HerdrError('screenshot_failed')`) |
| `src/herdr.ts` | Socket client: `request(socketPath, method, params, timeoutMs)` (one connection per request), `subscribe`, `parseLine`, `HerdrError { code }`, `httpStatus(code)`, `resolveSocketPath` |
| `src/http.ts` | Guards and I/O: `isSameOrigin(headers)` same-origin check, `readJson(req, maxBytes)` with 256 KB cap, `validateElement`, `validatePrompt(body)` (20000-char cap, up to 4 `extras`, optional `screenshot`), `sendJson` response writer |
| `src/compose.ts` | Pure shared: `renderAttachment(el, extras?)` markdown serializer with `## Element N` sections, `composePrompt(el, prompt, { attachmentPath?, extras?, screenshotPath? })` ASCII prompt builder |
| `src/client/index.ts` | UI host: shadow-DOM picker, hotkey listener, pick mode with outline sync, shift+click multi-selection (numbered boxes, up to 5 elements total), popup with a To field (collapsed by default, showing the preselected target's name/status/branch/pane; `Up`/`Down` or a click expands the agent list below it), a listbox where the two spawn rows (`+ agent here` / `+ agent in worktree`) are options alongside the agents so `Enter`/`Send` on one spawns then sends in a single step, the screenshot switch (shown only when live state reports `screenshot: 'available'`, persisted in `localStorage['herdr:shot']`), copy fallback, toast, in-flight outline driven by `herdr:status` HMR events (falls back to polling `/state`) with one status vocabulary shared by the list's status dots, the outline and the chips (violet working, green idle/done, red blocked); exposes `window.__herdr = { version, describe, outline, pick, close, inflight, selection, screenshotEnabled }` for e2e/bench |
| `src/client/dom.ts` | Pure DOM helpers: `parseHotkey`, `deepElementFromPoint`, `sourceHint`, `selectorPath`, `trimHtml`, `styleSummary`, `describeElement`, `popupPathLabel`, `spawnHint(kind, devLabel)`, `truncateStart(value, max)` |
| `src/client/agents.ts` | Pure state: `groupAgents(state)`, `selectableIds(groups)`, `pickAgent(state, last)`, `devWorkspaceLabel(state)` |

## Build Strategy

One `vite.config.ts` with two modes:

- **Node build** (`mode` unset): Entry `src/index.ts`, external `/^node:/` and `vite`, `vite-plugin-dts` with `bundleTypes: true` and `processor: 'ts'` for single `dist/index.d.ts` via api-extractor, target `node20`.
- **Client build** (`mode === 'client'`): Entry `src/client/index.ts`, `fileName: 'client.js'`, `emptyOutDir: false`, target `es2022`, no minify.

Run both: `vite build && vite build --mode client`.

TypeScript configuration: `allowImportingTsExtensions: true` enables `.ts` extension imports. Virtual module resolution: `resolveId('virtual:vite-plugin-herdr/client')` points Vite to the real client file. When `import.meta.url` ends in `.ts`, Vite serves sources (demo, tests); in `.js`, it serves the built `dist/client.js` (published package).

## Contracts

Plugin options:

```typescript
interface Options {
  hotkey?: string                  // ctrl+b
  socketPath?: string              // $HERDR_SOCKET_PATH, fallback ~/.config/herdr/herdr.sock
  enabled?: boolean                // true
  endpoint?: string                // /__herdr
  appendTo?: string | RegExp       // meta-framework client injection
  screenshot?: boolean | 'auto'    // 'auto': available only on darwin
  screenshotCommand?: string       // 'screencapture'; advanced, points at a test double
  snippet?: { maxDepth?, maxLines?, inlineMaxChars? }  // 3, 60, 1500
}
```

Server endpoints:

| Route | Method | Request | Response |
|-------|--------|---------|----------|
| `{base}/__herdr/state` | GET | none | 200: `StateResponse` (live branch carries `screenshot: 'available' \| 'unsupported' \| 'off'`); 403: cross-origin; 502: socket missing |
| `{base}/__herdr/prompt` | POST | JSON max 256KB, `element` + up to 4 `extras` + optional `screenshot` | 200: `PromptResponse` (`screenshot: string \| null`, the captured PNG path); 400/409/413: error; 502/503: server errors |
| `{base}/__herdr/spawn` | POST | JSON max 64KB | 200: `SpawnResponse`; 400/409/413: error; 502/503: server errors |

A screenshot capture failure inside `postPrompt` never surfaces as an HTTP error: it is caught, logged with `console.warn('[vite-plugin-herdr] screenshot failed: ...')`, and the prompt still goes out without the `Screenshot:` line.

Client does not read `import.meta.env`; it parses hotkey and endpoint from query string injected at `transformIndexHtml`.
