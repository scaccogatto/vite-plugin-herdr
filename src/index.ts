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
  /**
   * Appends the client import to matching modules instead of relying on
   * transformIndexHtml, for meta-frameworks whose app type isn't spa/mpa.
   * A string matches ids ending with it; a RegExp is tested against the id
   * (query stripped). For Nuxt use `appendTo: /\/entry\.m?js$/` (Nuxt's
   * client entry); for SvelteKit use
   * `appendTo: /vite\/dist\/client\/client\.mjs(?:\?|$)/`; for Astro use
   * the integration's `injectScript` instead of this option.
   */
  appendTo?: string | RegExp
  /**
   * Offers the real-pixel screenshot checkbox in the popup. `'auto'`
   * (default) turns it on only on macOS (the only platform `screenshotCommand`
   * currently supports); `true` forces it on, `false` turns it off.
   */
  screenshot?: boolean | 'auto'
  /**
   * Advanced: the command run to capture the screenshot, invoked as
   * `<command> -x -R <x>,<y>,<w>,<h> <file>`. Defaults to macOS's own
   * `screencapture`; override only to point at a test double.
   */
  screenshotCommand?: string
}

/** Resolved options with all defaults applied */
export type ResolvedOptions = Required<Omit<Options, 'socketPath' | 'snippet' | 'appendTo'>> & {
  socketPath: string | undefined
  snippet: { maxDepth: number; maxLines: number; inlineMaxChars: number }
  appendTo: string | RegExp | undefined
}

/** Virtual module ID for the client entry */
export const VIRTUAL_ID = 'virtual:vite-plugin-herdr/client'

/** Builds the query string carrying client options, injected alongside the virtual module id */
function clientQuery(resolved: ResolvedOptions): string {
  return new URLSearchParams({
    hotkey: resolved.hotkey,
    endpoint: resolved.endpoint,
    maxDepth: String(resolved.snippet.maxDepth),
    maxLines: String(resolved.snippet.maxLines),
  }).toString()
}

/** Resolve options with documented defaults */
export function resolveOptions(options: Options): ResolvedOptions {
  const defaults: ResolvedOptions = {
    hotkey: 'ctrl+b',
    endpoint: '/__herdr',
    enabled: true,
    socketPath: undefined,
    appendTo: undefined,
    screenshot: 'auto',
    screenshotCommand: 'screencapture',
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

  const appendTo = resolved.appendTo

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
        screenshot: resolved.screenshot,
        screenshotCommand: resolved.screenshotCommand,
      })
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        // Vite only calls this hook for spa/mpa app types; appendTo covers
        // meta-frameworks (Nuxt, SvelteKit) whose html isn't transformed here.
        if (appendTo) return undefined

        const params = clientQuery(resolved)

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

    ...(appendTo
      ? {
          transform(code: string, id: string) {
            const bareId = id.split('?')[0] ?? id
            const matches = typeof appendTo === 'string' ? bareId.endsWith(appendTo) : appendTo.test(bareId)
            if (!matches) return undefined

            const params = clientQuery(resolved)
            return { code: `${code}\nimport '${VIRTUAL_ID}?${params}'\n`, map: null }
          },
        }
      : {}),
  }
}

export type * from './types.ts'
