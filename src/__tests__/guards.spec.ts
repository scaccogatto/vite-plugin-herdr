import { mkdtempSync, mkdirSync, statSync, symlinkSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Connect, ViteDevServer } from 'vite'
import { describe, it, expect } from 'vitest'
import { ATTACHMENT_DIR, ensurePrivateDir, mountRoutes, writeAttachment } from '../server.ts'

const posix = process.platform !== 'win32'

interface Captured {
  status: number
  body: unknown
  nextCalled: boolean
}

/** Mounts the routes on a stub dev server and returns the registered middleware */
function mountedHandler(allowRemote?: boolean): Connect.NextHandleFunction {
  let handler: Connect.NextHandleFunction | undefined
  const server = {
    config: { base: '/', root: process.cwd() },
    middlewares: {
      use(_path: string, fn: Connect.NextHandleFunction) {
        handler = fn
      },
    },
    ws: { send() {} },
  } as unknown as ViteDevServer

  mountRoutes(server, {
    endpoint: '/__herdr',
    socketPath: join(tmpdir(), 'vph-no-such-socket.sock'),
    inlineMaxChars: 1500,
    attachmentDir: mkdtempSync(join(tmpdir(), 'vph-guard-')),
    allowRemote,
  })
  if (!handler) throw new Error('mountRoutes registered no middleware')
  return handler
}

/** Runs one request through the middleware: an unknown path falls through to next() once the guards pass */
async function run(handler: Connect.NextHandleFunction, remoteAddress: string | undefined, headers: Record<string, string>): Promise<Captured> {
  const captured: Captured = { status: 0, body: undefined, nextCalled: false }
  const req = { url: '/unknown', method: 'GET', headers, socket: { remoteAddress } } as unknown as IncomingMessage
  const stub: { statusCode: number; setHeader(): void; end(chunk: string): void } = {
    statusCode: 0,
    setHeader() {},
    end(chunk) {
      captured.status = stub.statusCode
      captured.body = JSON.parse(chunk)
    },
  }
  const res = stub as unknown as ServerResponse
  await handler(req, res, () => {
    captured.nextCalled = true
  })
  return captured
}

const sameOrigin = { 'sec-fetch-site': 'same-origin', host: 'localhost:5173' }

describe('mountRoutes network guard', () => {
  it('rejects a non-loopback peer with 403 even when it forges same-origin headers', async () => {
    const result = await run(mountedHandler(), '192.168.1.5', sameOrigin)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ error: 'forbidden' })
    expect(result.nextCalled).toBe(false)
  })

  it('rejects a request whose peer address is unknown', async () => {
    const result = await run(mountedHandler(), undefined, sameOrigin)
    expect(result.status).toBe(403)
  })

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('lets a same-origin request from %s through', async (address) => {
    const result = await run(mountedHandler(), address, sameOrigin)
    expect(result.nextCalled).toBe(true)
  })

  it.each([
    ['x-forwarded-for', '203.0.113.7'],
    ['forwarded', 'for=203.0.113.7;host=abc.ngrok.app'],
    ['cf-connecting-ip', '203.0.113.7'],
  ])('rejects a loopback request carrying %s (tunnel or reverse proxy) with 403', async (name, value) => {
    const result = await run(mountedHandler(), '127.0.0.1', { ...sameOrigin, [name]: value })
    expect(result.status).toBe(403)
    expect(result.nextCalled).toBe(false)
  })

  it('accepts a proxied request when allowRemote is true', async () => {
    const result = await run(mountedHandler(true), '127.0.0.1', { ...sameOrigin, 'x-forwarded-for': '203.0.113.7' })
    expect(result.nextCalled).toBe(true)
  })

  it('still rejects a cross-origin request from loopback', async () => {
    const result = await run(mountedHandler(), '127.0.0.1', { origin: 'http://evil.example', host: 'localhost:5173' })
    expect(result.status).toBe(403)
    expect(result.nextCalled).toBe(false)
  })

  it('accepts a non-loopback peer when allowRemote is true, keeping the same-origin check', async () => {
    const handler = mountedHandler(true)
    expect((await run(handler, '192.168.1.5', sameOrigin)).nextCalled).toBe(true)
    expect((await run(handler, '192.168.1.5', { host: 'localhost:5173' })).status).toBe(403)
  })
})

/** First non-internal IPv4 address of this machine, when it has one */
function lanAddress(): string | undefined {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address
}

/** Sends a GET over a real TCP connection and resolves with the status code */
function get(host: string, port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path: '/unknown', headers }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('mountRoutes network guard over a real socket', () => {
  const lan = lanAddress()

  async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
    const handler = mountedHandler()
    const server = createServer((req, res) => {
      void handler(req, res, () => {
        res.statusCode = 404
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
    const { port } = server.address() as AddressInfo
    return { port, close: () => new Promise((resolve) => server.close(() => resolve())) }
  }

  it('lets a same-origin request from 127.0.0.1 through and rejects one carrying X-Forwarded-For', async () => {
    const { port, close } = await listen()
    try {
      const headers = { 'sec-fetch-site': 'same-origin' }
      expect(await get('127.0.0.1', port, headers)).toBe(404)
      expect(await get('127.0.0.1', port, { ...headers, 'x-forwarded-for': '203.0.113.7' })).toBe(403)
    } finally {
      await close()
    }
  })

  it.runIf(lan !== undefined)('rejects a same-origin request that reaches the server through a non-loopback interface', async () => {
    const { port, close } = await listen()
    try {
      expect(await get(lan as string, port, { 'sec-fetch-site': 'same-origin' })).toBe(403)
    } finally {
      await close()
    }
  })
})

describe.runIf(posix)('attachment directory permissions', () => {
  it('names the default directory after the current uid', () => {
    expect(ATTACHMENT_DIR.endsWith(`vite-plugin-herdr-${process.getuid?.()}`)).toBe(true)
  })

  it('creates a missing directory with mode 0700 and writes files with mode 0600', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'vph-perm-')), 'attachments')
    const filePath = await writeAttachment('captured', dir)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
  })

  it('tightens an existing directory left world-readable by an older version', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'vph-perm-')), 'attachments')
    mkdirSync(dir)
    await chmod(dir, 0o755)
    await ensurePrivateDir(dir)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('refuses a symlink planted in place of the directory', async () => {
    const base = mkdtempSync(join(tmpdir(), 'vph-perm-'))
    const elsewhere = join(base, 'elsewhere')
    mkdirSync(elsewhere)
    const dir = join(base, 'attachments')
    symlinkSync(elsewhere, dir)
    await expect(writeAttachment('captured', dir)).rejects.toThrow(/not a directory/)
  })
})
