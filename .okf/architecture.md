---
type: Architecture
title: vite-plugin-herdr module design
description: Eight source modules split between server and client, sharing pure types and composition functions
tags: [plugin, vite, client-server, modules]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
---

## System Decomposition

Eight modules organize the plugin: five on Node (server), three on DOM (client), one pure layer shared.

**Server (Node)**: `index.ts` is the plugin factory; `herdr.ts` talks to the socket; `http.ts` handles dev-server routing and request validation; `types.ts` defines contracts.

**Shared (Pure)**: `compose.ts` renders HTML snippets and assembles prompts, free of Node and DOM imports.

**Client (DOM)**: `index.ts` hosts the picker UI in shadow DOM; `dom.ts` utilities: hotkey parsing, element geometry, source hints, selector paths, styling summaries; `agents.ts` groups and selects from herdr's agent list.

## Build Strategy

One `vite.config.ts` with two modes:

- **Node build** (`mode` unset): Entry `src/index.ts`, external `/^node:/` and `vite`, `vite-plugin-dts` bundles types, target `node20`.
- **Client build** (`mode === 'client'`): Entry `src/client/index.ts`, `fileName: 'client.js'`, `emptyOutDir: false`, target `es2022`, no minify.

Run both: `vite build && vite build --mode client`.

Virtual module resolution: `resolveId('virtual:vite-plugin-herdr/client')` points Vite to the real client file. When `import.meta.url` ends in `.ts`, Vite serves sources (demo, tests); in `.js`, it serves the built `dist/client.js` (published package).

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

Client does not read `import.meta.env`; it parses hotkey and endpoint from query string injected at `transformIndexHtml`.
