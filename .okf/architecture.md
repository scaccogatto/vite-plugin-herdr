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
---

## System Decomposition

Eight modules organize the plugin: four on Node (server), three on DOM (client), one pure layer shared between them. `compose.ts` is the shared layer specifically because it must have no Node and no DOM imports, it runs both in the server (composing the final prompt) and, unbuilt, in clipboard-fallback code paths.

| File | Responsibility |
|---|---|
| `src/index.ts` | Plugin entry: `resolveOptions`, `VIRTUAL_ID` constant, `resolveId` mapping virtual to real client, `transformIndexHtml` injection of client `<script>`, `configureServer` mounting the two routes |
| `src/server.ts` | Socket bridge: `mountRoutes`, `getState`, `toAgentRow`, `toWorkspaceRow`, `absolutizeHint`, `postPrompt`, `validateSpawn`, `spawnAgent`, `watchAgent`, `writeAttachment`, `cleanupAttachments` (24-hour file expiry) |
| `src/herdr.ts` | Socket client: `request(socketPath, method, params, timeoutMs)` (one connection per request), `subscribe`, `parseLine`, `HerdrError { code }`, `httpStatus(code)`, `resolveSocketPath` |
| `src/http.ts` | Guards and I/O: `isSameOrigin(headers)` same-origin check, `readJson(req, maxBytes)` with 256 KB cap, `validatePrompt(body)` 20000-char cap, `sendJson` response writer |
| `src/compose.ts` | Pure shared: `renderAttachment(el)` markdown serializer, `composePrompt(el, prompt, { attachmentPath? })` ASCII prompt builder |
| `src/client/index.ts` | UI host: shadow-DOM picker, hotkey listener, pick mode with outline sync, popup, send, copy fallback, toast; exposes `window.__herdr = { describe, outline }` for bench |
| `src/client/dom.ts` | Pure DOM helpers: `parseHotkey`, `deepElementFromPoint`, `sourceHint`, `selectorPath`, `trimHtml`, `styleSummary`, `describeElement` |
| `src/client/agents.ts` | Pure state: `groupAgents(state)`, `pickAgent(state, last)` |

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
  snippet?: { maxDepth?, maxLines?, inlineMaxChars? }  // 3, 60, 1500
}
```

Server endpoints:

| Route | Method | Request | Response |
|-------|--------|---------|----------|
| `{base}/__herdr/state` | GET | none | 200: `StateResponse`; 403: cross-origin; 502: socket missing |
| `{base}/__herdr/prompt` | POST | JSON max 256KB | 200: `PromptResponse`; 400/409/413: error; 502/503: server errors |
| `{base}/__herdr/spawn` | POST | JSON max 64KB | 200: `SpawnResponse`; 400/409/413: error; 502/503: server errors |

Client does not read `import.meta.env`; it parses hotkey and endpoint from query string injected at `transformIndexHtml`.
