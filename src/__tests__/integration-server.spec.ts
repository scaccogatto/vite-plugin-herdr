import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mountRoutes } from '../server.ts'
import { startFakeHerdr } from './helpers/fake-herdr.ts'
import type { FakeHerdr } from './helpers/fake-herdr.ts'

const fixturesRoot = join(import.meta.dirname, 'fixtures')

const sampleAgent = {
  pane_id: 'w33:p1',
  workspace_id: 'w33',
  agent_status: 'done',
  focused: false,
  agent: 'claude',
  cwd: '/x',
  terminal_title_stripped: 'Profilo LinkedIn',
  tokens: { branch: ' main' },
  agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 'a37c...' },
}

async function startTestServer(base?: string): Promise<{ server: ViteDevServer; origin: string; fake: FakeHerdr; close(): Promise<void> }> {
  const fake = await startFakeHerdr({
    'session.snapshot': () => ({
      type: 'session_snapshot',
      snapshot: { version: '0.8.2', protocol: '20', workspaces: [], agents: [sampleAgent] },
    }),
    'agent.prompt': (params) =>
      params.target === 'blocked:agent'
        ? { __error: { code: 'agent_blocked', message: 'agent is blocked' } }
        : { type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } },
  })

  const attachmentDir = mkdtempSync(join(tmpdir(), 'vph-int-'))

  const server = await createServer({
    configFile: false,
    root: fixturesRoot,
    base,
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1' },
    plugins: [
      {
        name: 'test-mount',
        configureServer(s) {
          mountRoutes(s, { endpoint: '/__herdr', socketPath: fake.socketPath, inlineMaxChars: 1500, attachmentDir })
        },
      },
    ],
  })

  await server.listen()
  const address = server.httpServer?.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`

  return {
    server,
    origin,
    fake,
    async close() {
      await server.close()
      await fake.close()
    },
  }
}

describe('integration: mounted routes on a real Vite dev server', () => {
  let ctx: Awaited<ReturnType<typeof startTestServer>>

  beforeAll(async () => {
    ctx = await startTestServer()
  }, 20000)

  afterAll(async () => {
    await ctx.close()
  })

  it(
    'GET /__herdr/state with matching Origin returns 200 with mapped agents',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/state`, { headers: { Origin: ctx.origin } })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { herdr: boolean; agents: { pane_id: string }[] }
      expect(body.herdr).toBe(true)
      expect(body.agents).toHaveLength(1)
      expect(body.agents[0]?.pane_id).toBe('w33:p1')
    },
    20000,
  )

  it(
    'GET /__herdr/state with a mismatched Origin returns 403',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/state`, { headers: { Origin: 'http://evil.example' } })
      expect(res.status).toBe(403)
    },
    20000,
  )

  it(
    'GET /__herdr/state with no Origin and no Sec-Fetch-Site returns 403',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/state`)
      expect(res.status).toBe(403)
    },
    20000,
  )

  it(
    'GET /__herdr/state with Sec-Fetch-Site: same-origin alone returns 200',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/state`, { headers: { 'Sec-Fetch-Site': 'same-origin' } })
      expect(res.status).toBe(200)
    },
    20000,
  )

  it(
    'POST /__herdr/prompt with a valid body returns 200 and the fake received a composed prompt',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/prompt`, {
        method: 'POST',
        headers: { Origin: ctx.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'w1:p1',
          prompt: 'Make it blue',
          element: {
            url: `${ctx.origin}/`,
            viewport: { w: 1440, h: 900 },
            hint: 'src/components/SettingsForm.vue:42:6',
            path: 'main > form.settings > button.btn.btn-primary',
            rect: { x: 100, y: 200, w: 320, h: 40 },
            html: '<button class="btn btn-primary">Save</button>',
            styles: { display: 'inline-flex' },
          },
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)

      const sent = ctx.fake.received.find((r) => r.method === 'agent.prompt')
      const text = sent?.params.text as string
      expect(text).toContain('Element: main > form.settings > button.btn.btn-primary')
      expect(text).toContain('---\nMake it blue')
      expect(text).toContain(`Focus: ${join(fixturesRoot, 'src/components/SettingsForm.vue')}:42:6`)
    },
    20000,
  )

  it(
    'POST /__herdr/prompt targeting a blocked agent returns 409',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/prompt`, {
        method: 'POST',
        headers: { Origin: ctx.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'blocked:agent',
          prompt: 'do it',
          element: {
            url: `${ctx.origin}/`,
            viewport: { w: 1440, h: 900 },
            hint: null,
            path: 'main',
            rect: { x: 0, y: 0, w: 10, h: 10 },
            html: '<main></main>',
            styles: {},
          },
        }),
      })

      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('agent_blocked')
    },
    20000,
  )

  it(
    'POST /__herdr/prompt with a body over 262144 bytes returns 413',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/prompt`, {
        method: 'POST',
        headers: { Origin: ctx.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'w1:p1',
          prompt: 'x'.repeat(300000),
          element: {
            url: `${ctx.origin}/`,
            viewport: { w: 1440, h: 900 },
            hint: null,
            path: 'main',
            rect: { x: 0, y: 0, w: 10, h: 10 },
            html: '<main></main>',
            styles: {},
          },
        }),
      })

      expect(res.status).toBe(413)
    },
    20000,
  )

  it(
    'POST /__herdr/prompt with content-type: text/plain returns 415',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/prompt`, {
        method: 'POST',
        headers: { Origin: ctx.origin, 'Content-Type': 'text/plain' },
        body: 'hello',
      })

      expect(res.status).toBe(415)
    },
    20000,
  )

  it(
    'GET /__herdr/prompt returns 405',
    async () => {
      const res = await fetch(`${ctx.origin}/__herdr/prompt`, { headers: { Origin: ctx.origin } })
      expect(res.status).toBe(405)
    },
    20000,
  )

  it(
    '/__herdr/nope is not handled by us, Vite answers 404',
    async () => {
      // Accept: application/json (Node fetch defaults to */*, which Vite's
      // html fallback middleware treats as "serve index.html"; our own
      // middleware only ever calls next(), it never produces this response)
      const receivedBefore = ctx.fake.received.length
      const res = await fetch(`${ctx.origin}/__herdr/nope`, {
        headers: { Origin: ctx.origin, Accept: 'application/json' },
      })
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).not.toBe('no-store')
      expect(ctx.fake.received).toHaveLength(receivedBefore)
    },
    20000,
  )
})

describe('integration: mounted routes with a non-root base', () => {
  let ctx: Awaited<ReturnType<typeof startTestServer>>

  beforeAll(async () => {
    ctx = await startTestServer('/app/')
  }, 20000)

  afterAll(async () => {
    await ctx.close()
  })

  it(
    'serves state at /app/__herdr/state',
    async () => {
      const res = await fetch(`${ctx.origin}/app/__herdr/state`, { headers: { Origin: ctx.origin } })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { herdr: boolean }
      expect(body.herdr).toBe(true)
    },
    20000,
  )
})
