import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { HerdrError } from '../herdr.ts'
import {
  absolutizeHint,
  cleanupAttachments,
  getState,
  postPrompt,
  spawnAgent,
  toAgentRow,
  toWorkspaceRow,
  validateSpawn,
  writeAttachment,
} from '../server.ts'
import { startFakeHerdr } from './helpers/fake-herdr.ts'
import type { FakeHerdr } from './helpers/fake-herdr.ts'

const sampleAgent = {
  pane_id: 'w33:p1',
  workspace_id: 'w33',
  agent_status: 'done',
  focused: false,
  agent: 'claude',
  cwd: '/x',
  terminal_title_stripped: 'Profilo LinkedIn',
  tokens: { branch: ' main' },
  agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 'a37c...' },
}

describe('toAgentRow', () => {
  it('maps a full agent, stripping the branch icon and extracting session', () => {
    expect(toAgentRow(sampleAgent)).toEqual({
      pane_id: 'w33:p1',
      workspace_id: 'w33',
      agent_status: 'done',
      agent: 'claude',
      title: 'Profilo LinkedIn',
      branch: 'main',
      session: 'a37c...',
      focused: false,
      cwd: '/x',
    })
  })

  it('falls back missing fields to null and agent_status to unknown', () => {
    expect(toAgentRow({ pane_id: 'w1:p1', workspace_id: 'w1' })).toEqual({
      pane_id: 'w1:p1',
      workspace_id: 'w1',
      agent_status: 'unknown',
      agent: null,
      title: null,
      branch: null,
      session: null,
      focused: false,
      cwd: null,
    })
  })
})

describe('toWorkspaceRow', () => {
  it('maps a workspace row', () => {
    expect(toWorkspaceRow({ workspace_id: 'w33', label: 'dotfiles', number: 1, focused: false })).toEqual({
      workspace_id: 'w33',
      label: 'dotfiles',
      number: 1,
      focused: false,
    })
  })

  it('falls back missing label to null and missing number to null', () => {
    expect(toWorkspaceRow({ workspace_id: 'w33', focused: true })).toEqual({
      workspace_id: 'w33',
      label: null,
      number: null,
      focused: true,
    })
  })
})

describe('absolutizeHint', () => {
  it('absolutizes a relative hint with line:col plus suffix', () => {
    expect(absolutizeHint('src/components/Button.tsx:42:10 (extra)', ['/repo'])).toBe(
      '/repo/src/components/Button.tsx:42:10 (extra)',
    )
  })

  it('leaves an absolute path hint unchanged', () => {
    expect(absolutizeHint('/repo/src/Button.tsx:42:10', ['/repo'])).toBe('/repo/src/Button.tsx:42:10')
  })

  it('leaves a non-matching hint unchanged', () => {
    expect(absolutizeHint('react component X, no file', ['/repo'])).toBe('react component X, no file')
  })

  it('returns null for a null hint', () => {
    expect(absolutizeHint(null, ['/repo'])).toBeNull()
  })

  it('tries each root in order for relative paths', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vph-test-'))
    mkdirSync(join(tmp, 'demo'))
    writeFileSync(join(tmp, 'demo', 'Bench.vue'), '')

    expect(absolutizeHint('demo/Bench.vue:11:7 (data-v-inspector)', [join(tmp, 'demo'), tmp])).toBe(
      `${join(tmp, 'demo', 'Bench.vue')}:11:7 (data-v-inspector)`,
    )
  })

  it('falls back to the first root when no file exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vph-test-'))
    mkdirSync(join(tmp, 'demo'))

    expect(absolutizeHint('nope/X.vue:3:4', [join(tmp, 'demo'), tmp])).toBe(
      `${join(tmp, 'demo', 'nope', 'X.vue')}:3:4`,
    )
  })

  it('finds a file in the second root when it does not exist in the first', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vph-test-'))
    mkdirSync(join(tmp, 'a'))
    mkdirSync(join(tmp, 'b'))
    writeFileSync(join(tmp, 'b', 'file.ts'), '')

    expect(absolutizeHint('file.ts:1:1', [join(tmp, 'a'), join(tmp, 'b')])).toBe(
      `${join(tmp, 'b', 'file.ts')}:1:1`,
    )
  })
})

describe('getState', () => {
  let fake: FakeHerdr | undefined

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  it('returns herdr:true with mapped agents and workspaces for protocol 20 (string)', async () => {
    fake = await startFakeHerdr({
      'session.snapshot': () => ({
        type: 'session_snapshot',
        snapshot: {
          version: '0.8.2',
          protocol: '20',
          workspaces: [{ workspace_id: 'w33', label: 'dotfiles', number: 1, focused: false }],
          agents: [sampleAgent],
        },
      }),
    })

    const state = await getState(fake.socketPath, { HERDR_WORKSPACE_ID: 'w33', HERDR_PANE_ID: 'w33:p1' })

    expect(state).toEqual({
      herdr: true,
      version: '0.8.2',
      protocol: 20,
      workspaceId: 'w33',
      paneId: 'w33:p1',
      workspaces: [{ workspace_id: 'w33', label: 'dotfiles', number: 1, focused: false }],
      agents: [toAgentRow(sampleAgent)],
    })
  })

  it('returns herdr:false reason protocol for protocol 19', async () => {
    fake = await startFakeHerdr({
      'session.snapshot': () => ({
        type: 'session_snapshot',
        snapshot: { version: '0.8.1', protocol: '19', workspaces: [], agents: [] },
      }),
    })

    const state = await getState(fake.socketPath, {})
    expect(state.herdr).toBe(false)
    expect(state).toMatchObject({ reason: 'protocol' })
  })

  it('returns herdr:false reason no_socket when the socket is missing', async () => {
    const state = await getState('/nonexistent/dir/herdr.sock', {})
    expect(state).toMatchObject({ herdr: false, reason: 'no_socket' })
  })
})

describe('postPrompt', () => {
  let fake: FakeHerdr | undefined
  let attachmentDir: string

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  const element = {
    url: 'http://localhost:3000/page',
    viewport: { w: 1440, h: 900 },
    hint: 'src/components/Button.tsx:42:10',
    path: 'body > main > button.primary',
    rect: { x: 100, y: 200, w: 320, h: 40 },
    html: '<button class="primary">Click me</button>',
    styles: { display: 'inline-flex' },
  }

  it('sends an inline prompt when under inlineMaxChars', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    const result = await postPrompt(
      { target: 'w1:p1', prompt: 'make it red', element },
      { socketPath: fake.socketPath, inlineMaxChars: 100000, roots: ['/repo'], attachmentDir },
    )

    expect(result).toEqual({ ok: true, target: 'w1:p1', title: 'my agent', pane_id: null })
    expect(fake.received).toHaveLength(1)
    const sent = fake.received[0]
    expect(sent?.method).toBe('agent.prompt')
    const text = sent?.params.text as string
    expect(text).toContain('Focus: /repo/src/components/Button.tsx:42:10')
    expect(text).not.toContain('Details:')

    const files = await readdir(attachmentDir)
    expect(files).toHaveLength(0)
  })

  it('returns pane_id from the agent.prompt result', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({
        type: 'agent_prompted',
        agent: { pane_id: 'w1:p9', terminal_title_stripped: 'my agent' },
      }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    const result = await postPrompt(
      { target: 'agent-name', prompt: 'make it red', element },
      { socketPath: fake.socketPath, inlineMaxChars: 100000, roots: ['/repo'], attachmentDir },
    )

    expect(result).toEqual({ ok: true, target: 'agent-name', title: 'my agent', pane_id: 'w1:p9' })
  })

  it('writes an attachment file when over inlineMaxChars', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    const result = await postPrompt(
      { target: 'w1:p1', prompt: 'make it red', element },
      { socketPath: fake.socketPath, inlineMaxChars: 5, roots: ['/repo'], attachmentDir },
    )

    expect(result.ok).toBe(true)
    const sent = fake.received[0]
    const text = sent?.params.text as string
    expect(text).toContain('Details:')
    expect(text).toContain('Focus: /repo/src/components/Button.tsx:42:10')

    const files = await readdir(attachmentDir)
    expect(files).toHaveLength(1)
    const written = await import('node:fs/promises').then((fs) => fs.readFile(join(attachmentDir, files[0] ?? ''), 'utf8'))
    expect(written).toContain('## Snippet')
  })
})

describe('writeAttachment', () => {
  it('writes the content and returns an absolute path that exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vph-wa-'))
    const filePath = await writeAttachment('hello world', dir)
    expect(filePath.startsWith(dir)).toBe(true)
    const content = await import('node:fs/promises').then((fs) => fs.readFile(filePath, 'utf8'))
    expect(content).toBe('hello world')
  })
})

describe('cleanupAttachments', () => {
  it('removes old .md files and keeps fresh ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vph-cleanup-'))
    const oldFile = join(dir, 'old.md')
    const freshFile = join(dir, 'fresh.md')
    await writeFile(oldFile, 'old')
    await writeFile(freshFile, 'fresh')

    const old = new Date(Date.now() - 2 * 86400000)
    await utimes(oldFile, old, old)

    await cleanupAttachments(dir, 86400000)

    const remaining = await readdir(dir)
    expect(remaining).toEqual(['fresh.md'])
  })

  it('ignores a missing directory', async () => {
    await expect(cleanupAttachments('/nonexistent/dir/for/sure')).resolves.toBeUndefined()
  })
})

describe('validateSpawn', () => {
  it('accepts mode here with no name or branch', () => {
    expect(validateSpawn({ mode: 'here' })).toEqual({ mode: 'here' })
  })

  it('accepts mode worktree with a valid name and branch', () => {
    expect(validateSpawn({ mode: 'worktree', name: 'pick-ab12', branch: 'feature/x' })).toEqual({
      mode: 'worktree',
      name: 'pick-ab12',
      branch: 'feature/x',
    })
  })

  it('rejects a missing or invalid mode', () => {
    expect(validateSpawn({})).toBeNull()
    expect(validateSpawn({ mode: 'elsewhere' })).toBeNull()
    expect(validateSpawn(null)).toBeNull()
    expect(validateSpawn('here')).toBeNull()
  })

  it('rejects a name that does not match the pattern', () => {
    expect(validateSpawn({ mode: 'here', name: 'Pick-1' })).toBeNull()
    expect(validateSpawn({ mode: 'here', name: '1pick' })).toBeNull()
    expect(validateSpawn({ mode: 'here', name: 'a'.repeat(33) })).toBeNull()
    expect(validateSpawn({ mode: 'here', name: '' })).toBeNull()
  })

  it('rejects a branch with whitespace, empty, or over 100 chars', () => {
    expect(validateSpawn({ mode: 'worktree', branch: 'has space' })).toBeNull()
    expect(validateSpawn({ mode: 'worktree', branch: '' })).toBeNull()
    expect(validateSpawn({ mode: 'worktree', branch: 'a'.repeat(101) })).toBeNull()
  })
})

describe('spawnAgent', () => {
  let fake: FakeHerdr | undefined

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  it('mode here splits the current pane and starts an agent', async () => {
    fake = await startFakeHerdr({
      'pane.split': () => ({ type: 'pane_split', pane: { pane_id: 'w1:p9' } }),
      'agent.start': () => ({ type: 'agent_started', agent: { pane_id: 'w1:p9' } }),
    })

    const result = await spawnAgent(
      { mode: 'here' },
      { socketPath: fake.socketPath, root: '/repo', env: { HERDR_PANE_ID: 'w1:p1', HERDR_WORKSPACE_ID: 'w1' } },
    )

    expect(result.ok).toBe(true)
    expect(result.pane_id).toBe('w1:p9')
    expect(result.workspace_id).toBe('w1')
    expect(result.name).toMatch(/^pick-[0-9a-f]{4}$/)

    const split = fake.received.find((r) => r.method === 'pane.split')
    expect(split?.params).toMatchObject({ target_pane_id: 'w1:p1', cwd: '/repo' })

    const start = fake.received.find((r) => r.method === 'agent.start')
    expect(start?.params).toMatchObject({ kind: 'claude', pane_id: 'w1:p9', name: result.name })
  })

  it('mode here honors an explicit name', async () => {
    fake = await startFakeHerdr({
      'pane.split': () => ({ type: 'pane_split', pane: { pane_id: 'w1:p9' } }),
      'agent.start': () => ({ type: 'agent_started', agent: { pane_id: 'w1:p9' } }),
    })

    const result = await spawnAgent(
      { mode: 'here', name: 'my-agent' },
      { socketPath: fake.socketPath, root: '/repo', env: { HERDR_PANE_ID: 'w1:p1' } },
    )

    expect(result.name).toBe('my-agent')
    const start = fake.received.find((r) => r.method === 'agent.start')
    expect(start?.params.name).toBe('my-agent')
  })

  it('mode here throws not_in_herdr when HERDR_PANE_ID is missing', async () => {
    fake = await startFakeHerdr({})

    await expect(spawnAgent({ mode: 'here' }, { socketPath: fake.socketPath, root: '/repo', env: {} })).rejects.toMatchObject(
      { code: 'not_in_herdr' },
    )
  })

  it('mode here throws not_in_herdr as a HerdrError instance', async () => {
    fake = await startFakeHerdr({})

    await expect(spawnAgent({ mode: 'here' }, { socketPath: fake.socketPath, root: '/repo', env: {} })).rejects.toBeInstanceOf(
      HerdrError,
    )
  })

  it('mode worktree creates a worktree carrying workspace_id and branch, then starts an agent', async () => {
    fake = await startFakeHerdr({
      'worktree.create': () => ({
        type: 'worktree_created',
        workspace: { workspace_id: 'w2' },
        root_pane: { pane_id: 'w2:p1' },
      }),
      'agent.start': () => ({ type: 'agent_started', agent: { pane_id: 'w2:p1' } }),
    })

    const result = await spawnAgent(
      { mode: 'worktree', branch: 'feature/x' },
      { socketPath: fake.socketPath, root: '/repo', env: { HERDR_WORKSPACE_ID: 'w1' } },
    )

    expect(result.ok).toBe(true)
    expect(result.pane_id).toBe('w2:p1')
    expect(result.workspace_id).toBe('w2')

    const created = fake.received.find((r) => r.method === 'worktree.create')
    expect(created?.params).toMatchObject({ workspace_id: 'w1', branch: 'feature/x' })

    const start = fake.received.find((r) => r.method === 'agent.start')
    expect(start?.params).toMatchObject({ kind: 'claude', pane_id: 'w2:p1' })
  })
})
