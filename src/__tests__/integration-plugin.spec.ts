import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    fake = await startFakeHerdr({
      'session.snapshot': () => snapshot,
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'Settings polish' } }),
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
    const sent = fake.received.find((r) => r.method === 'agent.prompt')
    expect(sent?.params.target).toBe('w1:p2')
    const text = String(sent?.params.text)
    expect(text).toContain(`Focus: ${join(fixtures, 'Bench.vue')}:12:5 (data-v-inspector)`)
    expect(text.endsWith('---\ntypo, should say Submit')).toBe(true)
  })

  it('rejects cross-origin callers', async () => {
    const res = await fetch(`${url}/__herdr/state`, { headers: { origin: 'http://evil.test' } })
    expect(res.status).toBe(403)
  })
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
