import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { mountRoutes } from './server.ts'

/** Options for the vite-plugin-herdr plugin */
export interface Options {
  hotkey?: string
  socketPath?: string
  enabled?: boolean
  endpoint?: string
  snippet?: {
    maxDepth?: number
    maxLines?: number
    inlineMaxChars?: number
  }
}

/** Resolved options with all defaults applied */
export type ResolvedOptions = Required<Omit<Options, 'socketPath' | 'snippet'>> & {
  socketPath: string | undefined
  snippet: { maxDepth: number; maxLines: number; inlineMaxChars: number }
}

/** Virtual module ID for the client entry */
export const VIRTUAL_ID = 'virtual:vite-plugin-herdr/client'

/** Resolve options with documented defaults */
export function resolveOptions(options: Options): ResolvedOptions {
  const defaults: ResolvedOptions = {
    hotkey: 'ctrl+b',
    endpoint: '/__herdr',
    enabled: true,
    socketPath: undefined,
    snippet: {
      maxDepth: 3,
      maxLines: 60,
      inlineMaxChars: 1500,
    },
  }

  return {
    ...defaults,
    ...options,
    snippet: {
      ...defaults.snippet,
      ...(options.snippet || {}),
    },
  }
}

/**
 * Default plugin factory: creates a Vite dev-server plugin that injects a DOM
 * picker and connects to herdr agents
 */
export default function herdr(options: Options = {}): Plugin {
  const resolved = resolveOptions(options)

  if (!resolved.enabled) {
    return {
      name: 'vite-plugin-herdr',
      apply: 'serve',
    }
  }

  // Client file path: the published package ships dist/index.js next to dist/client.js;
  // the demo and the tests import src/index.ts, whose neighbour is src/client/index.ts,
  // which Vite then serves and transforms with HMR.
  const clientFile = fileURLToPath(
    new URL(import.meta.url.endsWith('.ts') ? './client/index.ts' : './client.js', import.meta.url),
  )

  return {
    name: 'vite-plugin-herdr',
    apply: 'serve',

    resolveId(id: string) {
      const queryIndex = id.indexOf('?')
      const bare = queryIndex === -1 ? id : id.slice(0, queryIndex)
      const query = queryIndex === -1 ? '' : id.slice(queryIndex)

      if (bare === VIRTUAL_ID) {
        return query ? `${clientFile}${query}` : clientFile
      }

      return undefined
    },

    configureServer(server) {
      mountRoutes(server, {
        endpoint: resolved.endpoint,
        socketPath: resolved.socketPath,
        inlineMaxChars: resolved.snippet.inlineMaxChars,
      })
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        const params = new URLSearchParams({
          hotkey: resolved.hotkey,
          endpoint: resolved.endpoint,
          maxDepth: String(resolved.snippet.maxDepth),
          maxLines: String(resolved.snippet.maxLines),
        }).toString()

        return [
          {
            tag: 'script',
            attrs: {
              type: 'module',
              src: `/@id/${VIRTUAL_ID}?${params}`,
            },
            injectTo: 'body',
          },
        ]
      },
    },
  }
}

export type * from './types.ts'
