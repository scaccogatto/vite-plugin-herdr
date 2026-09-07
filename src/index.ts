import type { Plugin } from 'vite'

/// Options for the vite-plugin-herdr plugin
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

/// Default plugin factory: creates a Vite dev-server plugin that injects a DOM
/// picker and connects to herdr agents
export default function herdr(options: Options = {}): Plugin {
  void options

  return {
    name: 'vite-plugin-herdr',
    apply: 'serve',
  }
}

export type * from './types.ts'
