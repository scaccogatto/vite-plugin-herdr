import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer } from 'vite'
import herdr from '../index.ts'
import type { ViteDevServer } from 'vite'

vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 })

const fixturesDir = dirname(fileURLToPath(import.meta.url)) + '/fixtures'

let server: ViteDevServer | null = null

afterEach(async () => {
  if (server) {
    await server.close()
    server = null
  }
})

describe('herdr plugin integration', () => {
  it('default options: injects script with correct query params', async () => {
    server = await createServer({
      configFile: false,
      root: fixturesDir,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [herdr({})],
    })

    await server.listen()
    const baseUrl = server.resolvedUrls!.local[0]

    const indexRes = await fetch(`${baseUrl}`)
    expect(indexRes.status).toBe(200)
    const indexHtml = await indexRes.text()

    expect(indexHtml).toContain(
      'src="/@id/virtual:vite-plugin-herdr/client?hotkey=ctrl%2Bb&amp;endpoint=%2F__herdr&amp;maxDepth=3&amp;maxLines=60"',
    )

    const clientSrc = indexHtml.match(/src="(\/@id\/virtual:vite-plugin-herdr\/client\?[^"]+)"/)?.[1]
    expect(clientSrc).toBeDefined()

    if (!clientSrc) {
      throw new Error('clientSrc not found')
    }

    const clientRes = await fetch(new URL(clientSrc, baseUrl).href)
    expect(clientRes.status).toBe(200)
    expect(clientRes.headers.get('content-type')).toContain('javascript')
    const body = await clientRes.text()
    expect(body.length).toBeGreaterThan(0)
  })

  it('custom options appear in injected script query', async () => {
    server = await createServer({
      configFile: false,
      root: fixturesDir,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [
        herdr({
          hotkey: 'alt+p',
          endpoint: '/__x',
          snippet: { maxDepth: 2, maxLines: 20 },
        }),
      ],
    })

    await server.listen()
    const baseUrl = server.resolvedUrls!.local[0]
    if (!baseUrl) throw new Error('baseUrl not found')

    const indexRes = await fetch(baseUrl)
    const indexHtml = await indexRes.text()

    expect(indexHtml).toContain('hotkey=alt%2Bp')
    expect(indexHtml).toContain('endpoint=%2F__x')
    expect(indexHtml).toContain('maxDepth=2')
    expect(indexHtml).toContain('maxLines=20')
  })

  it('enabled false: does not inject virtual client module', async () => {
    server = await createServer({
      configFile: false,
      root: fixturesDir,
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [herdr({ enabled: false })],
    })

    await server.listen()
    const baseUrl = server.resolvedUrls!.local[0]
    if (!baseUrl) throw new Error('baseUrl not found')

    const indexRes = await fetch(baseUrl)
    const indexHtml = await indexRes.text()

    expect(indexHtml).not.toContain('virtual:vite-plugin-herdr')
  })

  it('base config: injects script with base prefix', async () => {
    server = await createServer({
      configFile: false,
      root: fixturesDir,
      base: '/app/',
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      plugins: [herdr({})],
    })

    await server.listen()
    const baseUrl = server.resolvedUrls!.local[0]
    if (!baseUrl) throw new Error('baseUrl not found')

    const indexRes = await fetch(baseUrl)
    expect(indexRes.status).toBe(200)
    const indexHtml = await indexRes.text()

    expect(indexHtml).toContain('src="/app/@id/virtual:vite-plugin-herdr/client?')
  })
})
