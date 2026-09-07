import { randomUUID } from 'node:crypto'
import net from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Error raised by the herdr socket client, carrying a free-form protocol
 * error code (for example agent_blocked, not_found, timeout, no_socket)
 */
export class HerdrError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'HerdrError'
    this.code = code
  }
}

/**
 * Resolves the herdr Unix socket path: explicit override, then
 * HERDR_SOCKET_PATH, then the default under the user's config dir
 */
export function resolveSocketPath(override?: string): string {
  return override ?? process.env.HERDR_SOCKET_PATH ?? join(homedir(), '.config', 'herdr', 'herdr.sock')
}

function mapConnectionError(err: NodeJS.ErrnoException): HerdrError {
  if (err.code === 'ENOENT') return new HerdrError('no_socket', err.message)
  if (err.code === 'EACCES' || err.code === 'EPERM') return new HerdrError('permission', err.message)
  return new HerdrError('unreachable', err.message)
}

/**
 * Parses one NDJSON response line, checking the id and unwrapping the
 * result or throwing the herdr-reported error
 */
export function parseLine(line: string, id: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new HerdrError('bad_response', 'invalid JSON from herdr')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new HerdrError('bad_response', 'invalid response shape from herdr')
  }

  const obj = parsed as Record<string, unknown>
  if (obj.id !== id) {
    throw new HerdrError('bad_response', 'response id mismatch')
  }

  if ('error' in obj && obj.error) {
    const err = obj.error as Record<string, unknown>
    const code = typeof err.code === 'string' ? err.code : 'unknown'
    const message = typeof err.message === 'string' ? err.message : ''
    throw new HerdrError(code, message)
  }

  return obj.result
}

/**
 * Sends one request over a fresh connection to the herdr socket: connect,
 * write one NDJSON line, read the first response line, close
 */
export function request(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 3000,
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const id = randomUUID()
    const socket = net.createConnection(socketPath)
    let buffer = ''
    let settled = false

    const timer = setTimeout(() => {
      settle(() => reject(new HerdrError('timeout', `no response within ${timeoutMs}ms`)))
      socket.destroy()
    }, timeoutMs)

    function settle(fn: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    socket.on('connect', () => {
      socket.write(JSON.stringify({ id, method, params }) + '\n')
    })

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const idx = buffer.indexOf('\n')
      if (idx === -1) return
      const line = buffer.slice(0, idx)
      settle(() => {
        try {
          resolvePromise(parseLine(line, id))
        } catch (err) {
          reject(err)
        }
      })
      socket.end()
    })

    socket.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => reject(mapConnectionError(err)))
    })

    socket.on('close', () => {
      settle(() => reject(new HerdrError('bad_response', 'connection closed before a full line was received')))
    })
  })
}

/**
 * Opens a long-lived connection subscribed to herdr events. The first
 * response line is the subscription ack (errors go to onError, closing the
 * connection); every following line is pushed to onEvent. There is no
 * unsubscribe: call close() to end the connection.
 */
export function subscribe(
  socketPath: string,
  subscriptions: Record<string, unknown>[],
  onEvent: (event: { event: string; data: Record<string, unknown> }) => void,
  onError?: (error: HerdrError) => void,
): { close(): void } {
  const id = randomUUID()
  const socket = net.createConnection(socketPath)
  let buffer = ''
  let gotFirstLine = false
  let closed = false

  function close(): void {
    if (closed) return
    closed = true
    socket.destroy()
  }

  function fail(error: HerdrError): void {
    onError?.(error)
    close()
  }

  socket.on('connect', () => {
    socket.write(JSON.stringify({ id, method: 'events.subscribe', params: { subscriptions } }) + '\n')
  })

  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)

      if (!gotFirstLine) {
        gotFirstLine = true
        try {
          parseLine(line, id)
        } catch (err) {
          fail(err instanceof HerdrError ? err : new HerdrError('bad_response', String(err)))
          return
        }
      } else {
        try {
          const msg = JSON.parse(line) as { event: string; data: Record<string, unknown> }
          onEvent({ event: msg.event, data: msg.data })
        } catch {
          fail(new HerdrError('bad_response', 'invalid event line from herdr'))
          return
        }
      }

      idx = buffer.indexOf('\n')
    }
  })

  socket.on('error', (err: NodeJS.ErrnoException) => {
    fail(mapConnectionError(err))
  })

  return { close }
}

/** Maps a herdr protocol error code to an HTTP status code */
export function httpStatus(code: string): number {
  switch (code) {
    case 'invalid_params':
      return 400
    case 'not_found':
      return 404
    case 'agent_blocked':
      return 409
    case 'not_in_herdr':
      return 409
    case 'busy':
      return 503
    default:
      return 502
  }
}
