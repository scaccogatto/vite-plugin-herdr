# vite-plugin-herdr

Vite dev-only plugin: injects a DOM element picker into the served page and sends selected elements with prompts to coding agents running in herdr through the dev server and herdr's Unix socket. Zero runtime dependencies. TypeScript strict. Tests with Vitest and Playwright end-to-end.

## Commands

- `npm run build`: Build the plugin and client modules (two modes: Node, then Client)
- `npm run typecheck`: Run TypeScript strict checks
- `npm run coverage`: Run tests with coverage
- `npm run lint`: Check code style with ESLint
- `npm run dev-demo`: Start the demo app in dev mode
- `npm run build-demo`: Build the demo app
- `npm run e2e`: Run Playwright end-to-end tests
- `node bench/capture.ts --out bench/results/<id>`: Capture payload benchmark fixtures (screenshots, `ElementInfo`) against the running demo
- `node bench/run.ts --out bench/results/<id> --model sonnet --reps 1`: Run the payload benchmark's headless `claude -p` sweep and write `runs.jsonl`/`summary.md`

## Development conventions

- **TypeScript imports**: All `.ts` files import from other `.ts` files with the `.ts` extension (e.g., `import { x } from './types.ts'`). This is enabled by `tsconfig.json` `allowImportingTsExtensions: true` and works in Vite because it transforms imports at dev time. Built output (`dist/index.js`) and published package (`dist/client.js`) ship built `.js` files that don't need extension paths.
- **Worktrees and commits**: For any task modifying code, use a git worktree (via EnterWorktree/ExitWorktree). Commit changes on your branch, then merge into main. Never commit generated `dist/` files; they are rebuilt on each build and added to `.gitignore`.
- **e2e specs must never reach a real herdr**: always start servers through `e2e/helpers/servers.ts` with an explicit fake socket.

## Open Knowledge Format (OKF)

This project keeps shared knowledge as an OKF bundle in `.okf/`.

- **Before a task**, if `.okf/` exists, read `.okf/index.md` first and follow
  links into the concepts relevant to the work. Weigh what you read: a `draft` or
  `deprecated` `status`, a `stale_after` already past, or no `verified` entry all
  mean "check before relying on this". Treat broken links as not-yet-written
  knowledge, not errors.
- **After a change** that affects a documented asset (service, API, schema,
  metric, runbook, decision), update the matching concept: refresh its body and
  `generated: { by, at }`, fix cross-links, and append a dated entry to the
  nearest `log.md`. Create a new concept for any new asset.
- **Capturing new knowledge** → use the `/okf:okf` skill (modes: produce,
  maintain, consume).
- **Before committing** bundle changes → run `/okf:validate .okf --strict` and
  resolve every error.

Conformance rule to respect: every concept file needs YAML frontmatter with a
non-empty `type`. Everything else is optional. The bundle targets OKF v0.2: if
you meet a v0.1 concept (a `timestamp` field or a `# Citations` section), migrate
it to `generated.at` / `sources` as part of the edit.
