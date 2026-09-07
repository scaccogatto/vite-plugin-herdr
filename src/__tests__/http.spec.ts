import { Readable } from 'node:stream'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { describe, it, expect } from 'vitest'
import { HttpError, isSameOrigin, readJson, sendJson, validatePrompt } from '../http.ts'
import type { ElementInfo, PromptRequest } from '../types.ts'

function fixtureElement(overrides?: Partial<ElementInfo>): ElementInfo {
  return {
    url: 'http://localhost:3000/page',
    viewport: { w: 1440, h: 900 },
    hint: 'src/components/Button.tsx:42:10',
    path: 'body > main > button.primary',
    rect: { x: 100, y: 200, w: 320, h: 40 },
    html: '<button class="primary">Click me</button>',
    styles: { display: 'inline-flex' },
    ...overrides,
  }
}

function fixtureBody(overrides?: Partial<PromptRequest>): PromptRequest {
  return {
    target: 'w1:p1',
    prompt: 'make it red',
    element: fixtureElement(),
    ...overrides,
  }
}

describe('isSameOrigin', () => {
  it('is true when sec-fetch-site is same-origin', () => {
    expect(isSameOrigin({ 'sec-fetch-site': 'same-origin' })).toBe(true)
  })

  it('is true when origin host matches headers.host including port', () => {
    const headers: IncomingHttpHeaders = { origin: 'http://localhost:5173', host: 'localhost:5173' }
    expect(isSameOrigin(headers)).toBe(true)
  })

  it('is false when origin host does not match', () => {
    const headers: IncomingHttpHeaders = { origin: 'http://evil.example', host: 'localhost:5173' }
    expect(isSameOrigin(headers)).toBe(false)
  })

  it('is false when origin is the literal "null"', () => {
    const headers: IncomingHttpHeaders = { origin: 'null', host: 'localhost:5173' }
    expect(isSameOrigin(headers)).toBe(false)
  })

  it('is false when origin and sec-fetch-site are both missing', () => {
    const headers: IncomingHttpHeaders = { host: 'localhost:5173' }
    expect(isSameOrigin(headers)).toBe(false)
  })
})

function fakeIncomingMessage(chunks: string[], headers: IncomingHttpHeaders): IncomingMessage {
  const stream = Readable.from(chunks.map((c) => Buffer.from(c))) as unknown as IncomingMessage
  stream.headers = headers
  return stream
}

describe('readJson', () => {
  it('parses a valid JSON body', async () => {
    const req = fakeIncomingMessage(['{"a":1}'], { 'content-type': 'application/json' })
    await expect(readJson(req, 1000)).resolves.toEqual({ a: 1 })
  })

  it('rejects non-json content-type with 415', async () => {
    const req = fakeIncomingMessage(['{"a":1}'], { 'content-type': 'text/plain' })
    await expect(readJson(req, 1000)).rejects.toMatchObject({ status: 415 })
  })

  it('rejects an oversized body with 413', async () => {
    const req = fakeIncomingMessage(['{"a":"' + 'x'.repeat(100) + '"}'], { 'content-type': 'application/json' })
    await expect(readJson(req, 10)).rejects.toMatchObject({ status: 413 })
  })

  it('destroys the request stream on oversized body without resetting the socket directly', async () => {
    // Regression guard: readJson must not call req.destroy() itself for the
    // 413 case. On a real socket that would destroy it while unread bytes
    // remain in the receive buffer, causing a TCP RST that also drops the
    // 413 response. Throwing out of `for await` destroys the stream on its
    // own (via the iterator's return()), which is what we assert here.
    const req = fakeIncomingMessage(['{"a":"' + 'x'.repeat(100) + '"}'], { 'content-type': 'application/json' })
    await expect(readJson(req, 10)).rejects.toMatchObject({ status: 413 })
    expect(req.destroyed).toBe(true)
  })

  it('rejects invalid json with 400', async () => {
    const req = fakeIncomingMessage(['not json'], { 'content-type': 'application/json' })
    await expect(readJson(req, 1000)).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an empty body with 400', async () => {
    const req = fakeIncomingMessage([], { 'content-type': 'application/json' })
    await expect(readJson(req, 1000)).rejects.toMatchObject({ status: 400 })
  })
})

describe('validatePrompt', () => {
  it('accepts a valid fixture', () => {
    const body = fixtureBody()
    expect(validatePrompt(body)).toEqual(body)
  })

  it('ignores unknown extra top-level keys', () => {
    const body = { ...fixtureBody(), extra: 'ignored' }
    expect(validatePrompt(body)).not.toBeNull()
  })

  it('rejects missing target', () => {
    const body = { prompt: 'x', element: fixtureElement() }
    expect(validatePrompt(body)).toBeNull()
  })

  it('rejects a prompt over 20000 chars', () => {
    const body = fixtureBody({ prompt: 'x'.repeat(20001) })
    expect(validatePrompt(body)).toBeNull()
  })

  it('rejects a numeric hint', () => {
    const body = fixtureBody({ element: fixtureElement({ hint: 123 as unknown as string }) })
    expect(validatePrompt(body)).toBeNull()
  })

  it('rejects styles with a non-string value', () => {
    const body = fixtureBody({
      element: fixtureElement({ styles: { color: 1 as unknown as string } }),
    })
    expect(validatePrompt(body)).toBeNull()
  })

  it('rejects a rect with NaN', () => {
    const body = fixtureBody({
      element: fixtureElement({ rect: { x: NaN, y: 0, w: 10, h: 10 } }),
    })
    expect(validatePrompt(body)).toBeNull()
  })

  it('rejects a non-object body', () => {
    expect(validatePrompt('nope')).toBeNull()
    expect(validatePrompt(null)).toBeNull()
  })

  describe('extras', () => {
    it('accepts up to 4 valid extras', () => {
      const extras = [fixtureElement(), fixtureElement(), fixtureElement(), fixtureElement()]
      const body = fixtureBody({ extras })
      expect(validatePrompt(body)).toEqual(body)
    })

    it('accepts a single extra', () => {
      const body = fixtureBody({ extras: [fixtureElement({ path: 'body > a' })] })
      expect(validatePrompt(body)).toEqual(body)
    })

    it('rejects more than 4 extras', () => {
      const extras = [fixtureElement(), fixtureElement(), fixtureElement(), fixtureElement(), fixtureElement()]
      expect(validatePrompt(fixtureBody({ extras }))).toBeNull()
    })

    it('rejects extras that is not an array', () => {
      const body = { ...fixtureBody(), extras: fixtureElement() }
      expect(validatePrompt(body)).toBeNull()
    })

    it('rejects extras containing an invalid element', () => {
      const extras = [fixtureElement(), fixtureElement({ hint: 123 as unknown as string })]
      expect(validatePrompt(fixtureBody({ extras }))).toBeNull()
    })

    it('omits extras from the result when not provided', () => {
      const result = validatePrompt(fixtureBody())
      expect(result).not.toBeNull()
      expect(result?.extras).toBeUndefined()
    })
  })
})

describe('sendJson', () => {
  it('sets status, headers and JSON body', () => {
    const headers: Record<string, string> = {}
    let statusCode = 0
    let ended = ''
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value
      },
      end(body: string) {
        ended = body
      },
      get statusCode() {
        return statusCode
      },
      set statusCode(v: number) {
        statusCode = v
      },
    } as unknown as ServerResponse

    sendJson(res, 200, { ok: true })

    expect(statusCode).toBe(200)
    expect(headers['content-type']).toBe('application/json; charset=utf-8')
    expect(headers['cache-control']).toBe('no-store')
    expect(ended).toBe(JSON.stringify({ ok: true }))
  })
})

describe('HttpError', () => {
  it('carries status and message', () => {
    const err = new HttpError(413, 'too big')
    expect(err.status).toBe(413)
    expect(err.message).toBe('too big')
  })
})
