import { mkdtempSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import herdr from '../index.ts'
import { startFakeHerdr, type FakeHerdr } from './helpers/fake-herdr.ts'

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))

const snapshot = {
  type: 'session_snapshot',
  snapshot: {
    version: '0.8.2',
    protocol: '20',
    workspaces: [{ workspace_id: 'w1', label: 'app', number: 1, focused: true }],
    agents: [
      {
        pane_id: 'w1:p2',
        workspace_id: 'w1',
        agent_status: 'idle',
        focused: false,
        agent: 'claude',
        cwd: '/tmp/app',
        terminal_title_stripped: 'Settings polish',
        tokens: { branch: ' main' },
        agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 's1' },
      },
    ],
  },
}

const element = {
  url: 'http://localhost:3131/#bench',
  viewport: { w: 1440, h: 900 },
  hint: 'Bench.vue:12:5 (data-v-inspector)',
  path: 'main > form.settings > button.btn.btn-primary',
  rect: { x: 10, y: 20, w: 100, h: 40 },
  html: '<button class="btn btn-primary" data-herdr-picked="">Save</button>',
  styles: { display: 'inline-flex' },
}

describe('plugin wires the herdr routes', () => {
  let fake: FakeHerdr
  let server: ViteDevServer
  let url: string

  beforeAll(async () => {
    writeFileSync(join(fixtures, 'Bench.vue'), '<template/>')
    fake = await startFakeHerdr({
      'session.snapshot': () => snapshot,
      'agent.prompt': () => ({
        type: 'agent_prompted',
        agent: { pane_id: 'w1:p2', terminal_title_stripped: 'Settings polish' },
      }),
      'pane.split': () => ({ type: 'pane_split', pane: { pane_id: 'w1:p9' } }),
      'agent.start': () => ({ type: 'agent_started', agent: { pane_id: 'w1:p9' } }),
    })
    server = await createServer({
      configFile: false,
      root: fixtures,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [herdr({ socketPath: fake.socketPath, snippet: { inlineMaxChars: 100000 } })],
    })
    await server.listen()
    url = server.resolvedUrls!.local[0]!.replace(/\/$/, '')
  }, 20000)

  afterAll(async () => {
    await server.close()
    await fake.close()
    try {
      await unlink(join(fixtures, 'Bench.vue'))
    } catch {
      // ignore if file doesn't exist
    }
  })

  it('serves the agent list from the fake herdr', async () => {
    const res = await fetch(`${url}/__herdr/state`, { headers: { origin: url } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { herdr: boolean; agents: { pane_id: string; branch: string | null }[] }
    expect(body.herdr).toBe(true)
    expect(body.agents[0]?.pane_id).toBe('w1:p2')
    expect(body.agents[0]?.branch).toBe('main')
  })

  it('submits a prompt with an absolute source hint', async () => {
    const res = await fetch(`${url}/__herdr/prompt`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'w1:p2', prompt: 'typo, should say Submit', element }),
    })
    expect(res.status).toBe(200)
    const sent = fake.received.filter((r) => r.method === 'agent.prompt').at(-1)
    expect(sent?.params.target).toBe('w1:p2')
    const text = String(sent?.params.text)
    expect(text).toContain(`Focus: ${join(fixtures, 'Bench.vue')}:12:5 (data-v-inspector)`)
    expect(text.endsWith('---\ntypo, should say Submit')).toBe(true)
  })

  it('resolves relative hints against fixtures when the file exists there', async () => {
    const res = await fetch(`${url}/__herdr/prompt`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'w1:p2', prompt: 'test relative path', element: { ...element, hint: 'Bench.vue:12:5 (data-v-inspector)' } }),
    })
    expect(res.status).toBe(200)
    const sent = fake.received.filter((r) => r.method === 'agent.prompt').at(-1)
    const text = String(sent?.params.text)
    expect(text).toContain(`Focus: ${join(fixtures, 'Bench.vue')}:12:5 (data-v-inspector)`)
  })

  it('resolves hints relative to parent of fixtures when prefixed with fixtures/', async () => {
    const res = await fetch(`${url}/__herdr/prompt`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'w1:p2', prompt: 'test parent path', element: { ...element, hint: 'fixtures/Bench.vue:12:5 (data-v-inspector)' } }),
    })
    expect(res.status).toBe(200)
    const sent = fake.received.filter((r) => r.method === 'agent.prompt').at(-1)
    const text = String(sent?.params.text)
    expect(text).toContain(`Focus: ${join(fixtures, 'Bench.vue')}:12:5 (data-v-inspector)`)
    expect(text).not.toContain('/fixtures/fixtures/')
  })

  it('rejects cross-origin callers', async () => {
    const res = await fetch(`${url}/__herdr/state`, { headers: { origin: 'http://evil.test' } })
    expect(res.status).toBe(403)
  })

  it('subscribes to pane.agent_status_changed for the prompted pane after a successful prompt', async () => {
    const countBefore = fake.received.filter((r) => r.method === 'events.subscribe').length

    const res = await fetch(`${url}/__herdr/prompt`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'w1:p2', prompt: 'watch this one', element }),
    })
    expect(res.status).toBe(200)

    const deadline = Date.now() + 2000
    let subs = fake.received.filter((r) => r.method === 'events.subscribe')
    while (subs.length <= countBefore && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
      subs = fake.received.filter((r) => r.method === 'events.subscribe')
    }

    expect(subs.length).toBeGreaterThan(countBefore)
    expect(subs.at(-1)?.params.subscriptions).toEqual([{ type: 'pane.agent_status_changed', pane_id: 'w1:p2' }])
  })

  describe('POST /__herdr/spawn', () => {
    const originalPaneId = process.env.HERDR_PANE_ID

    afterEach(() => {
      if (originalPaneId === undefined) delete process.env.HERDR_PANE_ID
      else process.env.HERDR_PANE_ID = originalPaneId
    })

    it('mode "here" returns 200 with the spawned pane id when HERDR_PANE_ID is set', async () => {
      process.env.HERDR_PANE_ID = 'w1:p1'

      const res = await fetch(`${url}/__herdr/spawn`, {
        method: 'POST',
        headers: { origin: url, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'here' }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; pane_id: string }
      expect(body.ok).toBe(true)
      expect(body.pane_id).toBe('w1:p9')
    })

    it('rejects an invalid mode with 400', async () => {
      const res = await fetch(`${url}/__herdr/spawn`, {
        method: 'POST',
        headers: { origin: url, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'nope' }),
      })

      expect(res.status).toBe(400)
    })

    it('returns 409 not_in_herdr when HERDR_PANE_ID is not set', async () => {
      delete process.env.HERDR_PANE_ID

      const res = await fetch(`${url}/__herdr/spawn`, {
        method: 'POST',
        headers: { origin: url, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'here' }),
      })

      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('not_in_herdr')
    })
  })
})

describe('plugin screenshot availability on /state', () => {
  it('reports screenshot: off when the plugin option is false', async () => {
    const fake = await startFakeHerdr({ 'session.snapshot': () => snapshot })
    const server = await createServer({
      configFile: false,
      root: fixtures,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [herdr({ socketPath: fake.socketPath, screenshot: false })],
    })
    await server.listen()
    const url = server.resolvedUrls!.local[0]!.replace(/\/$/, '')

    try {
      const res = await fetch(`${url}/__herdr/state`, { headers: { origin: url } })
      const body = (await res.json()) as { screenshot: string }
      expect(body.screenshot).toBe('off')
    } finally {
      await server.close()
      await fake.close()
    }
  }, 20000)

  it('reports screenshot: available when the plugin option is true', async () => {
    const fake = await startFakeHerdr({ 'session.snapshot': () => snapshot })
    const server = await createServer({
      configFile: false,
      root: fixtures,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [herdr({ socketPath: fake.socketPath, screenshot: true })],
    })
    await server.listen()
    const url = server.resolvedUrls!.local[0]!.replace(/\/$/, '')

    try {
      const res = await fetch(`${url}/__herdr/state`, { headers: { origin: url } })
      const body = (await res.json()) as { screenshot: string }
      expect(body.screenshot).toBe('available')
    } finally {
      await server.close()
      await fake.close()
    }
  }, 20000)
})

describe('plugin without herdr', () => {
  it('reports herdr as unreachable instead of failing', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'vph-')), 'none.sock')
    const server = await createServer({
      configFile: false,
      root: fixtures,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [herdr({ socketPath: missing })],
    })
    await server.listen()
    const url = server.resolvedUrls!.local[0]!.replace(/\/$/, '')
    try {
      const res = await fetch(`${url}/__herdr/state`, { headers: { 'sec-fetch-site': 'same-origin' } })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ herdr: false, reason: 'no_socket' })
    } finally {
      await server.close()
    }
  }, 20000)
})
