// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  PICKED_ATTR,
  HOST_ATTR,
  parseHotkey,
  matchesHotkey,
  deepElementFromPoint,
  sourceHint,
  selectorPath,
  trimHtml,
  styleSummary,
  describeElement,
} from '../client/dom.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('parseHotkey', () => {
  it('parses ctrl+b', () => {
    expect(parseHotkey('ctrl+b')).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: 'b' })
  })

  it('parses Cmd+Shift+K case-insensitively', () => {
    expect(parseHotkey('Cmd+Shift+K')).toEqual({ ctrl: false, shift: true, alt: false, meta: true, key: 'k' })
  })

  it('parses option+x as alt', () => {
    expect(parseHotkey('option+x')).toEqual({ ctrl: false, shift: false, alt: true, meta: false, key: 'x' })
  })

  it('throws when no key token is present', () => {
    expect(() => parseHotkey('ctrl+')).toThrow('hotkey needs a key')
  })
})

describe('matchesHotkey', () => {
  it('matches when modifiers and key match exactly', () => {
    const hk = parseHotkey('ctrl+b')
    const e = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true })
    expect(matchesHotkey(e, hk)).toBe(true)
  })

  it('rejects an event with an extra modifier held', () => {
    const hk = parseHotkey('ctrl+b')
    const e = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, shiftKey: true })
    expect(matchesHotkey(e, hk)).toBe(false)
  })

  it('matches the key case-insensitively', () => {
    const hk = parseHotkey('ctrl+b')
    const e = new KeyboardEvent('keydown', { key: 'B', ctrlKey: true })
    expect(matchesHotkey(e, hk)).toBe(true)
  })
})

describe('deepElementFromPoint', () => {
  it('returns the element at the point for a plain hit', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    document.elementFromPoint = () => div
    expect(deepElementFromPoint(10, 10, null)).toBe(div)
  })

  it('descends through an open shadow root via its own elementFromPoint', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    shadow.appendChild(inner)
    shadow.elementFromPoint = () => inner
    document.elementFromPoint = () => host
    expect(deepElementFromPoint(5, 5, null)).toBe(inner)
  })

  it('returns null when the hit element is the picker host or inside it', () => {
    const host = document.createElement('div')
    host.setAttribute(HOST_ATTR, '')
    const overlay = document.createElement('div')
    host.appendChild(overlay)
    document.body.appendChild(host)

    document.elementFromPoint = () => overlay
    expect(deepElementFromPoint(1, 1, host)).toBeNull()

    document.elementFromPoint = () => host
    expect(deepElementFromPoint(1, 1, host)).toBeNull()
  })

  it('returns the closest svg for an inner svg element', () => {
    const svg = document.createElementNS(SVG_NS, 'svg')
    const path = document.createElementNS(SVG_NS, 'path')
    svg.appendChild(path)
    document.body.appendChild(svg)
    document.elementFromPoint = () => path
    expect(deepElementFromPoint(1, 1, null)).toBe(svg)
  })

  it('does not descend into an iframe', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    document.elementFromPoint = () => iframe
    expect(deepElementFromPoint(1, 1, null)).toBe(iframe)
  })

  it('returns null when nothing is hit', () => {
    document.elementFromPoint = () => null
    expect(deepElementFromPoint(1, 1, null)).toBeNull()
  })
})

describe('sourceHint', () => {
  it('prefers data-v-inspector over data-loc on the same element', () => {
    const div = document.createElement('div')
    div.setAttribute('data-loc', 'foo.js:1')
    div.setAttribute('data-v-inspector', 'foo.vue:2')
    document.body.appendChild(div)
    expect(sourceHint(div)).toBe('foo.vue:2 (data-v-inspector)')
  })

  it('adds an ancestor suffix when the hint attribute is found higher up', () => {
    const parent = document.createElement('div')
    parent.setAttribute('data-loc', 'bar.js:5')
    const child = document.createElement('span')
    parent.appendChild(child)
    document.body.appendChild(parent)
    expect(sourceHint(child)).toBe('bar.js:5 (data-loc, ancestor)')
  })

  it('falls back to the Vue runtime component when no attribute is present', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    ;(div as unknown as Record<string, unknown>).__vueParentComponent = {
      type: { __file: 'src/Foo.vue', __name: 'Foo' },
    }
    expect(sourceHint(div)).toBe('src/Foo.vue (vue component Foo)')
  })

  it('falls back to the React fiber chain when no attribute or Vue component is present', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const MyComponent = Object.assign(() => null, { displayName: 'MyComponent' })
    ;(div as unknown as Record<string, unknown>)['__reactFiber$test'] = {
      return: { type: MyComponent, return: null },
    }
    expect(sourceHint(div)).toBe('react component MyComponent, no file')
  })

  it('returns null when nothing is found', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(sourceHint(div)).toBeNull()
  })
})

describe('selectorPath', () => {
  it('stops climbing at an id and does not include ancestors above it', () => {
    const grand = document.createElement('div')
    const parent = document.createElement('section')
    parent.id = 'main-section'
    const child = document.createElement('span')
    grand.appendChild(parent)
    parent.appendChild(child)
    document.body.appendChild(grand)
    expect(selectorPath(child)).toBe('section#main-section > span')
  })

  it('renders at most two classes', () => {
    const div = document.createElement('div')
    div.setAttribute('class', 'a b c')
    document.body.appendChild(div)
    expect(selectorPath(div)).toBe('div.a.b')
  })

  it('adds nth-of-type only when siblings share the tag and there is no id or class', () => {
    const parent = document.createElement('ul')
    const li1 = document.createElement('li')
    const li2 = document.createElement('li')
    const li3 = document.createElement('li')
    parent.append(li1, li2, li3)
    document.body.appendChild(parent)
    expect(selectorPath(li2)).toBe('ul > li:nth-of-type(2)')
  })

  it('omits nth-of-type when the element is the only one with that tag', () => {
    const parent = document.createElement('div')
    const only = document.createElement('span')
    parent.appendChild(only)
    document.body.appendChild(parent)
    expect(selectorPath(only)).toBe('div > span')
  })

  it('caps the path at 6 segments, keeping the deepest ones', () => {
    const tags = ['div', 'section', 'article', 'header', 'nav', 'main', 'aside', 'footer']
    let parent: HTMLElement | null = null
    let deepest: HTMLElement | null = null
    for (const tag of tags) {
      const el = document.createElement(tag)
      if (parent === null) document.body.appendChild(el)
      else parent.appendChild(el)
      parent = el
      deepest = el
    }
    if (deepest === null) throw new Error('unreachable')
    expect(selectorPath(deepest)).toBe('article > header > nav > main > aside > footer')
  })

  it('joins across a shadow boundary with >>>', () => {
    const host = document.createElement('div')
    host.id = 'shadow-host'
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    shadow.appendChild(inner)
    expect(selectorPath(inner)).toBe('div#shadow-host >>> span')
  })
})

describe('trimHtml', () => {
  it('marks the picked node exactly once', () => {
    const div = document.createElement('div')
    const picked = document.createElement('button')
    picked.textContent = 'Save'
    div.appendChild(picked)
    document.body.appendChild(div)

    const html = trimHtml(picked, { maxDepth: 3, maxLines: 60 })
    const occurrences = html.split(PICKED_ATTR).length - 1
    expect(occurrences).toBe(1)
    expect(html).toContain(`<button ${PICKED_ATTR}="">`)
  })

  it('drops elements hidden by style, the hidden attribute, aria-hidden, or the picker host marker', () => {
    const div = document.createElement('div')

    const byStyle = document.createElement('span')
    byStyle.setAttribute('style', 'display:none')
    byStyle.textContent = 'MARK_STYLE'

    const byHidden = document.createElement('span')
    byHidden.setAttribute('hidden', '')
    byHidden.textContent = 'MARK_HIDDEN'

    const byAria = document.createElement('span')
    byAria.setAttribute('aria-hidden', 'true')
    byAria.textContent = 'MARK_ARIA'

    const byHost = document.createElement('div')
    byHost.setAttribute(HOST_ATTR, '')
    byHost.textContent = 'MARK_HOST'

    const picked = document.createElement('button')
    picked.textContent = 'Save'

    div.append(byStyle, byHidden, byAria, byHost, picked)
    document.body.appendChild(div)

    const html = trimHtml(picked, { maxDepth: 3, maxLines: 60 })
    expect(html).not.toContain('MARK_STYLE')
    expect(html).not.toContain('MARK_HIDDEN')
    expect(html).not.toContain('MARK_ARIA')
    expect(html).not.toContain('MARK_HOST')
    expect(html).toContain('Save')
  })

  it('collapses an svg element instead of expanding its children', () => {
    const div = document.createElement('div')
    const svg = document.createElementNS(SVG_NS, 'svg')
    const path = document.createElementNS(SVG_NS, 'path')
    svg.appendChild(path)
    const picked = document.createElement('button')
    div.append(svg, picked)
    document.body.appendChild(div)

    const html = trimHtml(picked, { maxDepth: 3, maxLines: 60 })
    expect(html).toContain('<svg>...</svg>')
    expect(html).not.toContain('<path')
  })

  it('elides long attribute values to 77 chars plus an ellipsis', () => {
    const div = document.createElement('div')
    const picked = document.createElement('button')
    const longValue = 'x'.repeat(100)
    picked.setAttribute('data-long', longValue)
    div.appendChild(picked)
    document.body.appendChild(div)

    const html = trimHtml(picked, { maxDepth: 3, maxLines: 60 })
    expect(html).toContain(`data-long="${'x'.repeat(77)}..."`)
    expect(html).not.toContain(longValue)
  })

  it('elides long text nodes to 117 chars plus an ellipsis', () => {
    const div = document.createElement('div')
    const picked = document.createElement('p')
    const longText = 'y'.repeat(150)
    picked.textContent = longText
    div.appendChild(picked)
    document.body.appendChild(div)

    const html = trimHtml(picked, { maxDepth: 3, maxLines: 60 })
    expect(html).toContain(`${'y'.repeat(117)}...`)
    expect(html).not.toContain(longText)
  })

  it('collapses elements deeper than maxDepth to a child-count summary', () => {
    const root = document.createElement('div')
    const level1 = document.createElement('div')
    const level2 = document.createElement('div')
    const level3a = document.createElement('span')
    const level3b = document.createElement('span')
    level2.append(level3a, level3b)
    level1.appendChild(level2)
    const picked = document.createElement('button')
    root.append(level1, picked)
    document.body.appendChild(root)

    const html = trimHtml(picked, { maxDepth: 1, maxLines: 60 })
    expect(html).toContain('<div>...(2 children)</div>')
  })

  it('windows a 500-item child list to 2 siblings before and after the picked one', () => {
    const ul = document.createElement('ul')
    let picked: HTMLLIElement | null = null
    for (let i = 0; i < 500; i++) {
      const li = document.createElement('li')
      li.textContent = `item-${i}`
      ul.appendChild(li)
      if (i === 250) picked = li
    }
    document.body.appendChild(ul)
    if (picked === null) throw new Error('unreachable')

    const html = trimHtml(picked, { maxDepth: 3, maxLines: 5000 })
    expect(html).toContain('item-248')
    expect(html).toContain('item-249')
    expect(html).toContain('item-250')
    expect(html).toContain('item-251')
    expect(html).toContain('item-252')
    expect(html).not.toContain('item-247')
    expect(html).not.toContain('item-253')
    expect(html).toContain('<!-- 248 more -->')
    expect(html).toContain('<!-- 247 more -->')
  })

  it('caps total lines while always keeping the picked line visible', () => {
    const ul = document.createElement('ul')
    for (let i = 0; i < 3; i++) {
      const li = document.createElement('li')
      li.textContent = `filler-${i}`
      ul.appendChild(li)
    }
    const picked = document.createElement('li')
    picked.textContent = 'picked-item'
    ul.appendChild(picked)
    for (let i = 0; i < 30; i++) {
      const li = document.createElement('li')
      li.textContent = `tail-${i}`
      ul.appendChild(li)
    }
    document.body.appendChild(ul)

    const html = trimHtml(picked, { maxDepth: 3, maxLines: 10 })
    const lines = html.split('\n')
    expect(lines.length).toBeLessThanOrEqual(12)
    expect(html).toContain('picked-item')
    expect(html).toMatch(/<!-- \+\d+ lines -->/)
  })
})

describe('styleSummary', () => {
  // jsdom's getComputedStyle fills in UA-default values (display:block, position:static, ...)
  // for most of the tracked properties even with no inline style; only `overflow` and `gap`
  // stay empty absent an inline value, so those two are what exercise the non-empty filter here.
  it('surfaces inline styles for the tracked properties, preserving declaration order', () => {
    const div = document.createElement('div')
    div.setAttribute('style', 'color:red;display:flex;padding:4px;gap:8px;')
    document.body.appendChild(div)

    const styles = styleSummary(div)
    expect(styles.display).toBe('flex')
    expect(styles.padding).toBe('4px')
    expect(styles.color).toBe('rgb(255, 0, 0)')
    expect(styles.gap).toBe('8px')
    // Order follows the fixed property list, not the order they were set inline
    expect(Object.keys(styles).indexOf('display')).toBeLessThan(Object.keys(styles).indexOf('padding'))
    expect(Object.keys(styles).indexOf('padding')).toBeLessThan(Object.keys(styles).indexOf('color'))
    expect(Object.keys(styles).indexOf('color')).toBeLessThan(Object.keys(styles).indexOf('gap'))
  })

  it('omits a tracked property that has no computed value', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const styles = styleSummary(div)
    expect(styles).not.toHaveProperty('overflow')
    expect(styles).not.toHaveProperty('gap')

    div.setAttribute('style', 'overflow:hidden')
    expect(styleSummary(div).overflow).toBe('hidden')
  })
})

describe('describeElement', () => {
  it('captures the expected shape and rounds the bounding rect', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    div.getBoundingClientRect = () => ({
      x: 10.4,
      y: 20.6,
      width: 100.2,
      height: 50.7,
      left: 10.4,
      top: 20.6,
      right: 110.6,
      bottom: 71.3,
      toJSON() {
        return {}
      },
    })

    const info = describeElement(div, { maxDepth: 3, maxLines: 60 })
    expect(info.rect).toEqual({ x: 10, y: 21, w: 100, h: 51 })
    expect(info.url).toBe(location.href)
    expect(info.viewport).toEqual({ w: innerWidth, h: innerHeight })
    expect(info.path).toBe(selectorPath(div))
    expect(info.hint).toBeNull()
    expect(typeof info.html).toBe('string')
    expect(info.styles.display).toBe('block')
    expect(info.styles).not.toHaveProperty('gap')
  })
})
