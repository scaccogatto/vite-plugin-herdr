import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { ElementInfo, PromptRequest, ScreenshotRequest } from './types.ts'

/** Error raised by HTTP request handling, carrying the status code to send */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * True when the request came from the same origin as the dev server:
 * Sec-Fetch-Site: same-origin, or an Origin header whose host matches Host
 */
export function isSameOrigin(headers: IncomingHttpHeaders): boolean {
  if (headers['sec-fetch-site'] === 'same-origin') return true

  const origin = headers.origin
  if (typeof origin !== 'string') return false

  try {
    return new URL(origin).host === headers.host
  } catch {
    return false
  }
}

/** Reads and parses a JSON request body, enforcing content-type and a byte cap */
export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported media type')
  }

  let body = ''
  let bytes = 0
  for await (const chunk of req) {
    const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buf.length
    if (bytes > maxBytes) {
      // Throwing out of a `for await` loop calls the async iterator's
      // return(), which destroys the request stream on its own (detaching
      // the socket first). An explicit req.destroy() here would instead
      // destroy the shared socket directly while unread bytes remain in its
      // receive buffer, which makes the OS send a TCP RST and silently
      // drops the 413 response we are about to write.
      throw new HttpError(413, 'payload too large')
    }
    body += buf.toString('utf8')
  }

  if (body.length === 0) {
    throw new HttpError(400, 'empty body')
  }

  try {
    return JSON.parse(body)
  } catch {
    throw new HttpError(400, 'invalid json')
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

/** Max number of extra elements accepted alongside `element` on a prompt request */
const MAX_EXTRAS = 4

/** Validates an untrusted value against the ElementInfo shape, returning null when it does not match */
export function validateElement(x: unknown): ElementInfo | null {
  if (!isPlainObject(x)) return null

  const { url, path, html, hint, viewport, rect, styles } = x
  if (typeof url !== 'string') return null
  if (typeof path !== 'string') return null
  if (typeof html !== 'string') return null
  if (hint !== null && typeof hint !== 'string') return null

  if (!isPlainObject(viewport) || !isFiniteNumber(viewport.w) || !isFiniteNumber(viewport.h)) return null

  if (
    !isPlainObject(rect) ||
    !isFiniteNumber(rect.x) ||
    !isFiniteNumber(rect.y) ||
    !isFiniteNumber(rect.w) ||
    !isFiniteNumber(rect.h)
  ) {
    return null
  }

  if (!isPlainObject(styles)) return null
  for (const value of Object.values(styles)) {
    if (typeof value !== 'string') return null
  }

  return {
    url,
    path,
    html,
    hint,
    viewport: { w: viewport.w, h: viewport.h },
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    styles: styles as Record<string, string>,
  }
}

/** Validates an untrusted value against the ScreenshotRequest shape, returning null when it does not match */
function validateScreenshot(x: unknown): ScreenshotRequest | null {
  if (!isPlainObject(x)) return null

  const { rect, screenX, screenY, chromeLeft, chromeTop, dpr } = x

  if (
    !isPlainObject(rect) ||
    !isFiniteNumber(rect.x) ||
    !isFiniteNumber(rect.y) ||
    !isFiniteNumber(rect.w) ||
    !isFiniteNumber(rect.h)
  ) {
    return null
  }

  if (!isFiniteNumber(screenX) || !isFiniteNumber(screenY) || !isFiniteNumber(chromeLeft) || !isFiniteNumber(chromeTop) || !isFiniteNumber(dpr)) {
    return null
  }

  return {
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    screenX,
    screenY,
    chromeLeft,
    chromeTop,
    dpr,
  }
}

/**
 * Validates an untrusted request body against the PromptRequest shape,
 * returning null (never throwing) when it does not match
 */
export function validatePrompt(body: unknown): PromptRequest | null {
  if (!isPlainObject(body)) return null

  const { target, prompt, element, extras, screenshot } = body
  if (typeof target !== 'string' || target.length === 0) return null
  if (typeof prompt !== 'string' || prompt.length > 20000) return null

  const validatedElement = validateElement(element)
  if (validatedElement === null) return null

  const result: PromptRequest = { target, prompt, element: validatedElement }

  if (extras !== undefined) {
    if (!Array.isArray(extras) || extras.length > MAX_EXTRAS) return null

    const validatedExtras: ElementInfo[] = []
    for (const item of extras) {
      const validatedItem = validateElement(item)
      if (validatedItem === null) return null
      validatedExtras.push(validatedItem)
    }
    result.extras = validatedExtras
  }

  if (screenshot !== undefined) {
    const validatedScreenshot = validateScreenshot(screenshot)
    if (validatedScreenshot === null) return null
    result.screenshot = validatedScreenshot
  }

  return result
}

/** Writes a JSON response with the standard status, content-type and cache headers */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}
