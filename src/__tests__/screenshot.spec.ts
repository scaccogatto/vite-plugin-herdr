import { mkdtempSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HerdrError } from '../herdr.ts'
import { captureScreenshot, postPrompt, screenRegion, screenshotAvailability } from '../server.ts'
import { startFakeHerdr } from './helpers/fake-herdr.ts'
import type { FakeHerdr } from './helpers/fake-herdr.ts'
import type { ScreenshotRequest } from '../types.ts'

const FAKE_SCREENCAPTURE = fileURLToPath(new URL('./helpers/fake-screencapture.sh', import.meta.url))

describe('screenshotAvailability', () => {
  it('is off when the option is false, regardless of platform', () => {
    expect(screenshotAvailability(false, 'darwin')).toBe('off')
    expect(screenshotAvailability(false, 'linux')).toBe('off')
  })

  it('is available when the option is true, regardless of platform', () => {
    expect(screenshotAvailability(true, 'darwin')).toBe('available')
    expect(screenshotAvailability(true, 'linux')).toBe('available')
  })

  it('auto (or undefined) is available only on darwin', () => {
    expect(screenshotAvailability('auto', 'darwin')).toBe('available')
    expect(screenshotAvailability('auto', 'linux')).toBe('unsupported')
    expect(screenshotAvailability('auto', 'win32')).toBe('unsupported')
    expect(screenshotAvailability(undefined, 'darwin')).toBe('available')
    expect(screenshotAvailability(undefined, 'linux')).toBe('unsupported')
  })
})

function shot(overrides?: Partial<ScreenshotRequest>): ScreenshotRequest {
  return {
    rect: { x: 100, y: 200, w: 300, h: 40 },
    screenX: 0,
    screenY: 0,
    chromeLeft: 0,
    chromeTop: 80,
    dpr: 2,
    ...overrides,
  }
}

describe('screenRegion', () => {
  it('applies the default 40px margin around the element', () => {
    expect(screenRegion(shot())).toEqual({ x: 60, y: 240, w: 380, h: 120 })
  })

  it('honors a custom margin', () => {
    expect(screenRegion(shot(), 10)).toEqual({ x: 90, y: 270, w: 320, h: 60 })
  })

  it('adds screenX/screenY and chromeLeft/chromeTop into the crop origin', () => {
    expect(screenRegion(shot({ screenX: 50, screenY: 20, chromeLeft: 5, chromeTop: 100 }))).toEqual({
      x: 100 + 50 + 5 - 40,
      y: 200 + 20 + 100 - 40,
      w: 380,
      h: 120,
    })
  })

  it('rounds fractional inputs', () => {
    expect(screenRegion(shot({ rect: { x: 100.6, y: 200.4, w: 300.2, h: 40.7 } }))).toEqual({
      x: 61,
      y: 240,
      w: 380,
      h: 121,
    })
  })

  it('clamps width and height to a minimum of 16', () => {
    // margin 2 keeps 2*margin under 16, so a near-zero rect needs the clamp
    expect(screenRegion(shot({ rect: { x: 0, y: 0, w: 0, h: 0 } }), 2)).toEqual({ x: 0, y: 78, w: 16, h: 16 })
  })

  it('clamps width and height to a maximum of 4000', () => {
    expect(screenRegion(shot({ rect: { x: 0, y: 0, w: 5000, h: 5000 } }))).toEqual({ x: 0, y: 40, w: 4000, h: 4000 })
  })

  it('clamps x and y to a minimum of 0', () => {
    expect(
      screenRegion(shot({ screenX: 0, screenY: 0, chromeLeft: 0, chromeTop: 0, rect: { x: 0, y: 0, w: 100, h: 100 } })),
    ).toEqual({ x: 0, y: 0, w: 180, h: 180 })
  })
})

describe('captureScreenshot', () => {
  const prevFail = process.env.FAKE_SCREENCAPTURE_FAIL

  afterEach(() => {
    if (prevFail === undefined) delete process.env.FAKE_SCREENCAPTURE_FAIL
    else process.env.FAKE_SCREENCAPTURE_FAIL = prevFail
  })

  it('writes a non-empty file via the fake command', async () => {
    delete process.env.FAKE_SCREENCAPTURE_FAIL
    const dir = mkdtempSync(join(tmpdir(), 'vph-shot-'))
    const file = join(dir, 'shot.png')

    await captureScreenshot({ x: 0, y: 0, w: 100, h: 100 }, file, FAKE_SCREENCAPTURE)

    const info = await stat(file)
    expect(info.size).toBeGreaterThan(0)
  })

  it('throws HerdrError screenshot_failed when the command exits non-zero', async () => {
    process.env.FAKE_SCREENCAPTURE_FAIL = '1'
    const dir = mkdtempSync(join(tmpdir(), 'vph-shot-'))
    const file = join(dir, 'shot.png')

    await expect(captureScreenshot({ x: 0, y: 0, w: 100, h: 100 }, file, FAKE_SCREENCAPTURE)).rejects.toMatchObject({
      code: 'screenshot_failed',
    })
    await expect(captureScreenshot({ x: 0, y: 0, w: 100, h: 100 }, file, FAKE_SCREENCAPTURE)).rejects.toBeInstanceOf(HerdrError)
  })
})

describe('postPrompt with screenshot', () => {
  let fake: FakeHerdr | undefined
  let attachmentDir: string

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  const element = {
    url: 'http://localhost:3000/page',
    viewport: { w: 1440, h: 900 },
    hint: null,
    path: 'body > main > button.primary',
    rect: { x: 100, y: 200, w: 320, h: 40 },
    html: '<button class="primary" data-herdr-picked="">Click me</button>',
    styles: {},
  }

  it('captures the screenshot, composes the Screenshot line, and returns the path', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    const result = await postPrompt(
      { target: 'w1:p1', prompt: 'fix this', element, screenshot: shot() },
      {
        socketPath: fake.socketPath,
        inlineMaxChars: 100000,
        roots: ['/repo'],
        attachmentDir,
        screenshotCommand: FAKE_SCREENCAPTURE,
        screenshotEnabled: true,
      },
    )

    expect(result.screenshot).not.toBeNull()
    expect(result.screenshot?.endsWith('.png')).toBe(true)

    const text = fake.received[0]?.params.text as string
    expect(text).toContain(`Screenshot: ${result.screenshot} (real pixels, the picked element is outlined, 40px margin)`)

    const files = await readdir(attachmentDir)
    expect(files.some((f) => f.endsWith('.png'))).toBe(true)
  })

  it('logs a warning and still sends the prompt when the capture command fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    try {
      process.env.FAKE_SCREENCAPTURE_FAIL = '1'
      const result = await postPrompt(
        { target: 'w1:p1', prompt: 'fix this', element, screenshot: shot() },
        {
          socketPath: fake.socketPath,
          inlineMaxChars: 100000,
          roots: ['/repo'],
          attachmentDir,
          screenshotCommand: FAKE_SCREENCAPTURE,
          screenshotEnabled: true,
        },
      )

      expect(result.screenshot).toBeNull()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[vite-plugin-herdr] screenshot failed:'))

      const text = fake.received[0]?.params.text as string
      expect(text).not.toContain('Screenshot:')
    } finally {
      delete process.env.FAKE_SCREENCAPTURE_FAIL
      warn.mockRestore()
    }
  })

  it('omits the Screenshot line and returns null when the body carries no screenshot', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    const result = await postPrompt(
      { target: 'w1:p1', prompt: 'fix this', element },
      {
        socketPath: fake.socketPath,
        inlineMaxChars: 100000,
        roots: ['/repo'],
        attachmentDir,
        screenshotCommand: FAKE_SCREENCAPTURE,
        screenshotEnabled: true,
      },
    )

    expect(result.screenshot).toBeNull()
    const text = fake.received[0]?.params.text as string
    expect(text).not.toContain('Screenshot:')
  })

  it('does not capture when screenshotEnabled is false, even if the body carries one', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ type: 'agent_prompted', agent: { terminal_title_stripped: 'my agent' } }),
    })
    attachmentDir = mkdtempSync(join(tmpdir(), 'vph-att-'))

    const result = await postPrompt(
      { target: 'w1:p1', prompt: 'fix this', element, screenshot: shot() },
      {
        socketPath: fake.socketPath,
        inlineMaxChars: 100000,
        roots: ['/repo'],
        attachmentDir,
        screenshotCommand: FAKE_SCREENCAPTURE,
        screenshotEnabled: false,
      },
    )

    expect(result.screenshot).toBeNull()
    const text = fake.received[0]?.params.text as string
    expect(text).not.toContain('Screenshot:')
  })
})
