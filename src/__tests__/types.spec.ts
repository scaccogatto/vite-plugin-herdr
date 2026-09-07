import { describe, it, expect } from 'vitest'
import herdr from '../index'

describe('herdr plugin', () => {
  it('creates a plugin with the correct name and apply mode', () => {
    const plugin = herdr()
    expect(plugin.name).toBe('vite-plugin-herdr')
    expect(plugin.apply).toBe('serve')
  })
})
