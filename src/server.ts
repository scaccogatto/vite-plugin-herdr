import { randomBytes } from 'node:crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { ViteDevServer } from 'vite'
import { composePrompt, renderAttachment } from './compose.ts'
import { HerdrError, httpStatus, request, resolveSocketPath } from './herdr.ts'
import { HttpError, isSameOrigin, readJson, sendJson, validatePrompt } from './http.ts'
import type {
  AgentRow,
  AgentStatus,
  ElementInfo,
  PromptRequest,
  PromptResponse,
  StateResponse,
  WorkspaceRow,
} from './types.ts'

/// Options for mounting the herdr routes on a Vite dev server
export interface ServerOptions {
  endpoint: string
  socketPath: string | undefined
  inlineMaxChars: number
  attachmentDir?: string
}

/// Default directory for oversized element snippet attachments
export const ATTACHMENT_DIR = join(tmpdir(), 'vite-plugin-herdr')

function str(x: unknown): string | null {
  return typeof x === 'string' ? x : null
}

function obj(x: unknown): Record<string, unknown> | null {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null
}

function stripBranchIcon(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  const code = trimmed.codePointAt(0)
  if (code !== undefined && code >= 0xe000 && code <= 0xf8ff) {
    return trimmed.slice(1).trimStart()
  }
  return trimmed
}

/// Maps a raw herdr AgentInfo object to the AgentRow shape sent to the client
export function toAgentRow(a: Record<string, unknown>): AgentRow {
  const tokens = obj(a.tokens)
  const agentSession = obj(a.agent_session)

  return {
    pane_id: str(a.pane_id) ?? '',
    workspace_id: str(a.workspace_id) ?? '',
    agent_status: (str(a.agent_status) ?? 'unknown') as AgentStatus,
    agent: str(a.agent),
    title: str(a.terminal_title_stripped),
    branch: stripBranchIcon(tokens ? str(tokens.branch) : null),
    session: agentSession ? str(agentSession.value) : null,
    focused: Boolean(a.focused),
    cwd: str(a.cwd),
  }
}

/// Maps a raw herdr workspace object to the WorkspaceRow shape sent to the client
export function toWorkspaceRow(w: Record<string, unknown>): WorkspaceRow {
  return {
    workspace_id: str(w.workspace_id) ?? '',
    label: str(w.label),
    number: typeof w.number === 'number' && Number.isFinite(w.number) ? w.number : null,
    focused: Boolean(w.focused),
  }
}

/// Rewrites a relative source hint ("path:line[:col][suffix]") to an absolute
/// path resolved against root; hints that are already absolute, or don't
/// match the pattern, pass through unchanged
export function absolutizeHint(hint: string | null, root: string): string | null {
  if (hint === null) return null

  const match = hint.match(/^(\S+?):(\d+)(?::(\d+))?(.*)$/)
  if (!match) return hint

  const path = match[1]
  const line = match[2]
  const col = match[3]
  const rest = match[4] ?? ''
  if (!path || !line) return hint
  if (isAbsolute(path)) return hint

  const colPart = col ? `:${col}` : ''
  return `${resolve(root, path)}:${line}${colPart}${rest}`
}

/// Fetches the herdr session snapshot and maps it to the /state response shape
export async function getState(socketPath: string, env: NodeJS.ProcessEnv = process.env): Promise<StateResponse> {
  try {
    const top = obj(await request(socketPath, 'session.snapshot', {}))
    const snapshot = top ? obj(top.snapshot) : null

    const protocol = Number(snapshot?.protocol)
    if (!(protocol >= 20)) {
      return { herdr: false, reason: 'protocol', message: `herdr protocol ${protocol} is older than 20` }
    }

    const workspaces = Array.isArray(snapshot?.workspaces) ? snapshot.workspaces : []
    const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : []

    return {
      herdr: true,
      version: str(snapshot?.version) ?? '',
      protocol,
      workspaceId: env.HERDR_WORKSPACE_ID ?? null,
      paneId: env.HERDR_PANE_ID ?? null,
      workspaces: workspaces.map((w) => toWorkspaceRow(obj(w) ?? {})),
      agents: agents.map((a) => toAgentRow(obj(a) ?? {})),
    }
  } catch (err) {
    if (err instanceof HerdrError) {
      return { herdr: false, reason: err.code, message: err.message }
    }
    throw err
  }
}

/// Writes an attachment markdown file under dir, returning its absolute path
export async function writeAttachment(content: string, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `${Date.now()}-${randomBytes(3).toString('hex')}.md`)
  await writeFile(filePath, content, 'utf8')
  return filePath
}

/// Deletes attachment .md files older than maxAgeMs; ignores a missing
/// directory and per-file errors
export async function cleanupAttachments(dir: string, maxAgeMs = 86400000): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  const now = Date.now()
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.md'))
      .map(async (name) => {
        const filePath = join(dir, name)
        try {
          const info = await stat(filePath)
          if (now - info.mtimeMs > maxAgeMs) {
            await unlink(filePath)
          }
        } catch {
          // ignore per-file errors
        }
      }),
  )
}

/// Composes the prompt for a validated request and sends it to herdr,
/// writing an attachment file when the rendered snippet is too large to inline
export async function postPrompt(
  body: PromptRequest,
  opts: { socketPath: string; inlineMaxChars: number; root: string; attachmentDir: string },
): Promise<PromptResponse> {
  const el: ElementInfo = { ...body.element, hint: absolutizeHint(body.element.hint, opts.root) }
  const attachment = renderAttachment(el)

  const text =
    attachment.length > opts.inlineMaxChars
      ? composePrompt(el, body.prompt, { attachmentPath: await writeAttachment(attachment, opts.attachmentDir) })
      : composePrompt(el, body.prompt)

  const result = obj(await request(opts.socketPath, 'agent.prompt', { target: body.target, text }))
  const agent = result ? obj(result.agent) : null

  return {
    ok: true,
    target: body.target,
    title: agent ? str(agent.terminal_title_stripped) : null,
  }
}

/// Mounts the /state and /prompt herdr routes on the Vite dev server middleware
export function mountRoutes(server: ViteDevServer, opts: ServerOptions): void {
  const mount = server.config.base.replace(/\/$/, '') + opts.endpoint
  const socketPath = resolveSocketPath(opts.socketPath)
  const attachmentDir = opts.attachmentDir ?? ATTACHMENT_DIR
  const root = server.config.root

  cleanupAttachments(attachmentDir).catch(() => {})

  server.middlewares.use(mount, async (req, res, next) => {
    if (!isSameOrigin(req.headers)) {
      sendJson(res, 403, { error: 'forbidden', message: 'same-origin only' })
      return
    }

    const path = (req.url ?? '/').split('?')[0] ?? '/'

    try {
      if (path === '/state') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method_not_allowed', message: `${req.method} not allowed` })
          return
        }
        sendJson(res, 200, await getState(socketPath))
        return
      }

      if (path === '/prompt') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method_not_allowed', message: `${req.method} not allowed` })
          return
        }
        const promptReq = validatePrompt(await readJson(req, 262144))
        if (!promptReq) {
          sendJson(res, 400, { error: 'invalid_params', message: 'invalid prompt request' })
          return
        }
        sendJson(res, 200, await postPrompt(promptReq, { socketPath, inlineMaxChars: opts.inlineMaxChars, root, attachmentDir }))
        return
      }

      next()
    } catch (err) {
      if (err instanceof HttpError) {
        const errorValue = err.status === 413 ? 'payload_too_large' : err.status === 415 ? 'unsupported_media_type' : 'invalid_request'
        sendJson(res, err.status, { error: errorValue, message: err.message })
        return
      }
      if (err instanceof HerdrError) {
        sendJson(res, httpStatus(err.code), { error: err.code, message: err.message })
        return
      }
      sendJson(res, 500, { error: 'internal', message: err instanceof Error ? err.message : String(err) })
    }
  })
}
