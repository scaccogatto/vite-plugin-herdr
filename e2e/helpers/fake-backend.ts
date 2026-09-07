import type { Plugin } from 'vite'
import type { PromptRequest, StateResponse } from '../../src/types.ts'

/// Fixture: two workspaces, three agents, one idle, one working, one blocked
export const liveState: StateResponse = {
  herdr: true,
  version: '0.8.2',
  protocol: 1,
  workspaceId: 'w1',
  paneId: 'w1:p1',
  workspaces: [
    { workspace_id: 'w1', label: 'app', number: 1, focused: true },
    { workspace_id: 'w2', label: 'docs', number: 2, focused: false },
  ],
  agents: [
    {
      pane_id: 'w1:p2',
      workspace_id: 'w1',
      agent_status: 'idle',
      agent: 'claude',
      title: 'Settings polish',
      branch: 'main',
      session: 's1',
      focused: false,
      cwd: null,
    },
    {
      pane_id: 'w1:p3',
      workspace_id: 'w1',
      agent_status: 'working',
      agent: 'claude',
      title: 'Long task',
      branch: 'main',
      session: 's2',
      focused: false,
      cwd: null,
    },
    {
      pane_id: 'w2:p1',
      workspace_id: 'w2',
      agent_status: 'blocked',
      agent: 'codex',
      title: 'Waiting',
      branch: 'main',
      session: 's3',
      focused: false,
      cwd: null,
    },
  ],
}

/// Fixture: herdr unreachable, forces clipboard-fallback mode
export const downState: StateResponse = {
  herdr: false,
  reason: 'no_socket',
  message: 'no socket',
}

/// Vite plugin mounting fake /__herdr/state and /__herdr/prompt routes for e2e tests
export function fakeBackend(options: { state: StateResponse; promptStatus?: (target: string) => number }): Plugin & {
  received: PromptRequest[]
} {
  const received: PromptRequest[] = []

  return {
    name: 'fake-herdr-backend',
    received,
    configureServer(server) {
      server.middlewares.use('/__herdr/state', (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(options.state))
      })

      server.middlewares.use('/__herdr/prompt', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PromptRequest
          received.push(body)

          const status = options.promptStatus?.(body.target) ?? 200
          res.statusCode = status
          res.setHeader('content-type', 'application/json')

          if (status === 200) {
            res.end(JSON.stringify({ ok: true, target: body.target, title: 'Fake agent' }))
            return
          }
          if (status === 409) {
            res.end(JSON.stringify({ error: 'agent_blocked', message: 'blocked' }))
            return
          }
          if (status === 404) {
            res.end(JSON.stringify({ error: 'not_found', message: 'gone' }))
            return
          }
          res.end(JSON.stringify({ error: 'error', message: 'error' }))
        })
      })
    },
  }
}
