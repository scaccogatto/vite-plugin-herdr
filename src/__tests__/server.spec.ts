import { mkdtempSync } from 'node:fs'
import { readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import {
  absolutizeHint,
  cleanupAttachments,
  getState,
  postPrompt,
  toAgentRow,
  toWorkspaceRow,
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
    expect(absolutizeHint('src/components/Button.tsx:42:10 (extra)', '/repo')).toBe(
      '/repo/src/components/Button.tsx:42:10 (extra)',
    )
  })

  it('leaves an absolute path hint unchanged', () => {
    expect(absolutizeHint('/repo/src/Button.tsx:42:10', '/repo')).toBe('/repo/src/Button.tsx:42:10')
  })

  it('leaves a non-matching hint unchanged', () => {
    expect(absolutizeHint('react component X, no file', '/repo')).toBe('react component X, no file')
  })

  it('returns null for a null hint', () => {
    expect(absolutizeHint(null, '/repo')).toBeNull()
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
      { socketPath: fake.socketPath, inlineMaxChars: 100000, root: '/repo', attachmentDir },
    )

    expect(result).toEqual({ ok: true, target: 'w1:p1', title: 'my agent' })
    expect(fake.received).toHaveLength(1)
    const sent = fake.received[0]
    expect(sent?.method).toBe('agent.prompt')
    const text = sent?.params.text as string
    expect(text).toContain('Focus: /repo/src/components/Button.tsx:42:10')
    expect(text).not.toContain('Details:')

    const files = await readdir(attachmentDir)
    expect(files).toHaveLength(0)
  })

  it('writes an attachment file when over inlineMaxChars', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    const result = await postPrompt(
      { target: 'w1:p1', prompt: 'make it red', element },
      { socketPath: fake.socketPath, inlineMaxChars: 5, root: '/repo', attachmentDir },
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
