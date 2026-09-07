# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (in-browser overlay) + Node (Vite dev-server plugin), outside the ios/android/adaptive schema values: vite-plugin-herdr is an overlay injected into whatever web app you're already running under `vite dev`, paired with a Node-side bridge in the same process. No native mobile or desktop surface, no standalone server.

## Users

Frontend developers who run coding agents (Claude Code, Codex, and others) in herdr terminal sessions while they work in the browser. First user and design partner: the author, a freelancer running many Claude Code sessions in herdr inside Ghostty, switching constantly between "I see the bug in the browser" and "I need to describe it to the right agent pane". Confirmed destination: **public open source** (public GitHub, npm, curated docs for third parties).

## Product Purpose

Remove the context switch between spotting something in the browser and getting a coding agent to fix it: pick the element, type the prompt, choose the agent (or let it preselect), the fix lands as a normal turn and shows up via HMR. Success: the agent gets everything it needs to find the file and understand the change without the developer leaving the browser tab.

## Positioning

The only tool with a picker across live agent sessions. Neighbors are either closed and single-agent (Cursor Design Mode, GitHub Copilot browser tools, Windsurf's "Send element"), open-source but still single-target (stagewise, MCP Pointer, PinPoint, claude-code-inspector and its siblings), or solve a different problem (agent-source-locator sends a location with no picker or herdr integration; LocatorJS and friends open an editor, not an agent; Claude in Chrome and Chrome DevTools MCP run in the opposite direction, the agent drives the browser). vite-plugin-herdr is a Vite plugin specifically because the dev server is already a bridge: it runs inside a herdr pane, inherits that workspace's identity, and locator plugins already inject source hints into the DOM it serves.

## Operating Context

- Dev only: `apply: 'serve'`, never touches a production build
- Best experienced with the dev server started inside a herdr pane, so it inherits `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_PANE_ID`; outside herdr the picker still works, falling back to a clipboard copy of the composed prompt
- Needs herdr 0.8.2+ (socket protocol 20) to send prompts directly; older or absent herdr degrades to clipboard automatically, never an error state
- Source hints are best with a locator plugin in the app's own Vite config (`vite-plugin-vue-inspector`, `code-inspector-plugin`, `agent-source-locator`, `vite-plugin-jsx-loc`); without one, Vue's dev runtime gives a file, React's fiber gives only a component name, and the picker still works from the selector path alone
- macOS and Linux are the primary targets; Windows requires `HERDR_SOCKET_PATH` set manually since Unix sockets aren't discovered automatically there

## Capabilities and Constraints

- Public API: `import herdr from 'vite-plugin-herdr'`, used as `plugins: [vue(), herdr()]`; options `hotkey`, `socketPath`, `enabled`, `endpoint`, `snippet: { maxDepth, maxLines, inlineMaxChars }`, `appendTo` (meta-frameworks), `screenshot` (`'auto'`, macOS only) and the advanced `screenshotCommand`
- Three dev-server endpoints, same-origin only: `GET {endpoint}/state` (herdr reachability, workspaces, agents, screenshot availability), `POST {endpoint}/prompt` (send to a chosen agent, starts a status watch), `POST {endpoint}/spawn` (new agent in a split pane or a fresh worktree)
- Zero runtime dependencies: Node stdlib only (`net`, `fs`, `os`, `path`, `crypto`, `child_process`) on the server side, no framework on the client (vanilla DOM in a shadow-DOM host)
- Text-first payload always; the real-pixel screenshot is opt-in and ships only because the pre-registered benchmark promoted the outlined variant (`docs/payload.md`); no DOM-to-canvas re-render, ever
- Shipped in 0.1.0: in-flight outline until the agent settles, multi-select with one shared comment (up to five elements), spawn a new agent from the popup, `appendTo` injection for Nuxt and SvelteKit, opt-in outlined screenshot on macOS
- Confirmed Won't (for now): fake or re-rendered screenshots, a fixed localhost port as transport, a Chrome extension for pages you serve yourself (that is the extension's job for pages you do not serve)
- Roadmap: a Chrome extension for pages the dev server does not serve; Astro and other meta-framework recipes beyond `appendTo`

## Brand Commitments

Name `vite-plugin-herdr` (follows the `vite-plugin-*` npm naming convention; `herdr` names the agent-orchestration layer it bridges to). Logo: a crosshair-over-element mark with the wordmark, `#1e1e2e` ground and `#cba6f7` accent, consistent with the Catppuccin palette used across the author's other tools (`.github/logo.svg`, `.github/icon.svg`). MIT license.

## Evidence on Hand

- `docs/`: stack.md (decision + evaluated alternatives, dated 2026-09-07), flows.md (pick/send/fallback/error/benchmark flows), payload.md (payload reasoning + pre-registered benchmark protocol)
- `.okf/`: architecture, payload, herdr-protocol, security, benchmark, release concepts, status `draft` until the code they describe lands and is verified
- No third-party users, testimonials, or benchmark results yet: none are fabricated here; the benchmark's Results section stays "Pending" until it runs

## Product Principles

1. **Text before pixels**: every capability starts from deterministic, greppable text; an image is added only when measured evidence says it earns its cost
2. **The dev server is the whole bridge**: no new port, no daemon, no extension for pages you already serve
3. **Same-origin is the security model**: no token, because a token would only re-authenticate a request that same-origin already trusts
4. **Degrade, don't fail**: no herdr, old herdr, blocked agent, gone agent, every one of these is a handled state (clipboard, toast, disabled row), never a crash or a silent no-op
5. **One real user before a thousand hypothetical**: features grow from the author's own herdr/Ghostty workflow first, then generalize for the open-source audience
