import { describe, it, expect } from 'vitest'
import herdr, { VIRTUAL_ID, resolveOptions } from '../index.ts'

describe('resolveOptions', () => {
  it('returns documented defaults for empty options', () => {
    const resolved = resolveOptions({})

    expect(resolved.hotkey).toBe('ctrl+b')
    expect(resolved.endpoint).toBe('/__herdr')
    expect(resolved.enabled).toBe(true)
    expect(resolved.socketPath).toBe(undefined)
    expect(resolved.snippet.maxDepth).toBe(3)
    expect(resolved.snippet.maxLines).toBe(60)
    expect(resolved.snippet.inlineMaxChars).toBe(1500)
  })

  it('merges overrides while keeping other defaults', () => {
    const resolved = resolveOptions({
      snippet: { maxLines: 10 },
    })

    expect(resolved.snippet.maxDepth).toBe(3)
    expect(resolved.snippet.maxLines).toBe(10)
    expect(resolved.snippet.inlineMaxChars).toBe(1500)
  })

  it('accepts all custom options', () => {
    const resolved = resolveOptions({
      hotkey: 'alt+p',
      endpoint: '/__x',
      enabled: false,
      socketPath: '/tmp/herdr.sock',
      snippet: { maxDepth: 2, maxLines: 20, inlineMaxChars: 1000 },
    })

    expect(resolved.hotkey).toBe('alt+p')
    expect(resolved.endpoint).toBe('/__x')
    expect(resolved.enabled).toBe(false)
    expect(resolved.socketPath).toBe('/tmp/herdr.sock')
    expect(resolved.snippet.maxDepth).toBe(2)
    expect(resolved.snippet.maxLines).toBe(20)
    expect(resolved.snippet.inlineMaxChars).toBe(1000)
  })
})

describe('herdr plugin', () => {
  it('returns disabled plugin when enabled is false', () => {
    const plugin = herdr({ enabled: false })

    expect(plugin.name).toBe('vite-plugin-herdr')
    expect(plugin.apply).toBe('serve')
    expect((plugin as unknown as Record<string, unknown>).resolveId).toBeUndefined()
    expect((plugin as unknown as Record<string, unknown>).transformIndexHtml).toBeUndefined()
  })

  it('exports VIRTUAL_ID constant', () => {
    expect(VIRTUAL_ID).toBe('virtual:vite-plugin-herdr/client')
  })

  it('calls resolveId hook with virtual module id and returns client file path', () => {
    const plugin = herdr({})
    const resolveId = plugin.resolveId

    if (typeof resolveId === 'object' && resolveId !== null && 'handler' in resolveId) {
      // resolveId is { handler }
      const result = (resolveId.handler as (id: string) => unknown)(VIRTUAL_ID + '?hotkey=x')
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
      expect(result).toContain('client/index.ts')
      expect(result).toContain('?hotkey=x')
    } else if (typeof resolveId === 'function') {
      // resolveId is a function
      const result = (resolveId as (id: string) => unknown)(VIRTUAL_ID + '?hotkey=x')
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
      expect(result).toContain('client/index.ts')
      expect(result).toContain('?hotkey=x')
    } else {
      throw new Error('resolveId should be a function or object with handler')
    }
  })

  it('resolveId returns undefined for unrelated ids', () => {
    const plugin = herdr({})
    const resolveId = plugin.resolveId

    const callResolveId = (id: string) => {
      if (typeof resolveId === 'object' && resolveId !== null && 'handler' in resolveId) {
        return (resolveId.handler as (id: string) => unknown)(id)
      } else if (typeof resolveId === 'function') {
        return (resolveId as (id: string) => unknown)(id)
      }
      return undefined
    }

    const result = callResolveId('some/other/module')
    expect(result).toBeUndefined()
  })
})

function callHook(hook: unknown, ...args: unknown[]): unknown {
  if (typeof hook === 'object' && hook !== null && 'handler' in hook) {
    return (hook as { handler: (...a: unknown[]) => unknown }).handler(...args)
  }
  if (typeof hook === 'function') {
    return (hook as (...a: unknown[]) => unknown)(...args)
  }
  throw new Error('hook should be a function or object with handler')
}

describe('appendTo', () => {
  it('without appendTo, there is no transform hook', () => {
    const plugin = herdr({})
    expect((plugin as unknown as Record<string, unknown>).transform).toBeUndefined()
  })

  it('with appendTo, transform appends the client import for matching ids and leaves others untouched', () => {
    const plugin = herdr({ appendTo: 'entry.ts' })

    expect(plugin.transform).toBeDefined()
    const matched = callHook(plugin.transform, 'const x = 1', '/app/entry.ts?v=1') as
      | { code: string; map: null }
      | undefined
    expect(matched).toBeDefined()
    expect(matched?.code).toBe(
      "const x = 1\nimport 'virtual:vite-plugin-herdr/client?hotkey=ctrl%2Bb&endpoint=%2F__herdr&maxDepth=3&maxLines=60'\n",
    )
    expect(matched?.map).toBeNull()

    const unmatched = callHook(plugin.transform, 'const y = 2', '/app/other.ts')
    expect(unmatched).toBeUndefined()
  })

  it('with appendTo, transformIndexHtml returns undefined', () => {
    const plugin = herdr({ appendTo: 'entry.ts' })
    const result = callHook(plugin.transformIndexHtml)
    expect(result).toBeUndefined()
  })

  it('with appendTo as a RegExp, matches ids by pattern', () => {
    const plugin = herdr({ appendTo: /\/entry\.m?js$/ })

    const matched = callHook(plugin.transform, 'code', '/app/entry.mjs') as { code: string } | undefined
    expect(matched).toBeDefined()

    const unmatched = callHook(plugin.transform, 'code', '/app/entry.ts')
    expect(unmatched).toBeUndefined()
  })
})
