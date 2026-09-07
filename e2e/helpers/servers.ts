import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import inspector from 'vite-plugin-vue-inspector'
import herdr from '../../src/index.ts'
import type { Options } from '../../src/index.ts'
import { startFakeHerdr, type FakeHerdr } from '../../src/__tests__/helpers/fake-herdr.ts'

const demoRoot = fileURLToPath(new URL('../../demo', import.meta.url))

/** One request the fake herdr received, method plus raw params */
export interface RawReceived {
  method: string
  params: Record<string, unknown>
}

export interface StartDemoOptions {
  /** Raw `session.snapshot` result the fake herdr answers with, or null to run without a fake (real routes see no socket) */
  snapshot: unknown | null
  /** When set, the fake answers `agent.prompt` with this herdr error instead of a success */
  promptError?: { code: string; message: string } | null
  /** Env vars set on process.env for the lifetime of the server (getState reads these at request time) */
  env?: Record<string, string>
  /** Additional fake herdr method handlers, merged over (and able to override) the defaults */
  handlers?: Record<string, (params: Record<string, unknown>) => unknown>
  /** Additional herdr() plugin options, merged in (socketPath always comes from the fake, never from here) */
  plugin?: Partial<Options>
}

export interface DemoServer {
  url: string
  fake: FakeHerdr | null
  /** Prompts the fake herdr's `agent.prompt` received, mapped to the server-composed request */
  received(): { target: string; text: string }[]
  /** Every request the fake herdr received, unfiltered (e.g. to look for `events.subscribe`) */
  raw(): RawReceived[]
  close(): Promise<void>
}

/**
 * Looks up the target pane's own title in a `session.snapshot` fixture (the
 * shape `fixtures.ts` exports), so the fake herdr's `agent.prompt` answer
 * names the actual agent instead of a fixed placeholder - real herdr's
 * terminal_title_stripped is the pane's own title on every response, and the
 * client's "Sent to ..." toast reads it back. Falls back to a placeholder
 * for snapshots or targets this can't resolve (fixtures shaped differently).
 */
function titleForTarget(snapshot: unknown, target: unknown): string {
  if (typeof target !== 'string') return 'Fake agent'
  const agents = (snapshot as { snapshot?: { agents?: unknown } } | null)?.snapshot?.agents
  if (!Array.isArray(agents)) return 'Fake agent'
  const agent = agents.find((a) => (a as { pane_id?: unknown })?.pane_id === target) as
    | { terminal_title_stripped?: unknown }
    | undefined
  return typeof agent?.terminal_title_stripped === 'string' ? agent.terminal_title_stripped : 'Fake agent'
}

/**
 * Asserts a socketPath is an explicit, non-empty string. startDemo always
 * computes one itself (a fake herdr socket, or a fresh empty directory) and
 * never lets the plugin fall back to HERDR_SOCKET_PATH, which on a developer
 * machine may point at a real, live herdr with real agent sessions.
 */
export function assertExplicitSocketPath(socketPath: string | undefined): asserts socketPath is string {
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    throw new Error('startDemo requires an explicit socketPath; refusing to fall back to HERDR_SOCKET_PATH')
  }
}

/**
 * Waits for the agent list's GET /state to resolve and preselect an agent
 * (rendered as an aria-selected option) before the caller sends a prompt in
 * live-herdr mode: pressing Enter before this resolves can race ahead of it,
 * and the client falls back to clipboard mode instead of posting /prompt.
 * The selected option sits inside the collapsed (hidden) groups wrapper by
 * default, so this only asserts it is attached, not visible; callers that
 * need the To row itself can additionally check that.
 */
export async function waitForPreselectedAgent(page: Page): Promise<void> {
  await expect(page.locator('[data-herdr-host] [role="option"][aria-selected="true"]')).toBeAttached()
  await expect(page.locator('[data-herdr-host] .to-row')).not.toBeEmpty()
}

/**
 * Starts the demo app with the real vite-plugin-herdr plugin (the same
 * routes and options as vite.config.demo.ts), backed by a fake herdr Unix
 * socket instead of the developer's real one.
 */
export async function startDemo(opts: StartDemoOptions): Promise<DemoServer> {
  const fake =
    opts.snapshot !== null
      ? await startFakeHerdr({
          'session.snapshot': () => opts.snapshot,
          'agent.prompt': (params) =>
            opts.promptError
              ? { __error: opts.promptError }
              : {
                  type: 'agent_prompted',
                  agent: { pane_id: params.target, terminal_title_stripped: titleForTarget(opts.snapshot, params.target) },
                },
          ...opts.handlers,
        })
      : null

  const socketPath = fake ? fake.socketPath : join(await mkdtemp(join(tmpdir(), 'vph-e2e-')), 'missing.sock')
  assertExplicitSocketPath(socketPath)

  const prevEnv: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    prevEnv[key] = process.env[key]
    process.env[key] = value
  }

  const server: ViteDevServer = await createServer({
    configFile: false,
    root: demoRoot,
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1' },
    plugins: [
      vue(),
      inspector({ enabled: false, toggleButtonVisibility: 'never', toggleComboKey: false, cleanHtml: false }),
      herdr({ ...opts.plugin, socketPath }),
    ],
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server did not resolve a local url')

  return {
    url,
    fake,
    received() {
      return (fake?.received ?? [])
        .filter((r) => r.method === 'agent.prompt')
        .map((r) => ({ target: String(r.params.target), text: String(r.params.text) }))
    },
    raw() {
      return fake?.received ?? []
    },
    async close() {
      await server.close()
      await fake?.close()
      for (const [key, value] of Object.entries(prevEnv)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}
