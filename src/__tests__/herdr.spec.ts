import { describe, it, expect, afterEach } from 'vitest'
import { HerdrError, httpStatus, parseLine, request, subscribe } from '../herdr.ts'
import { startFakeHerdr } from './helpers/fake-herdr.ts'
import type { FakeHerdr } from './helpers/fake-herdr.ts'

describe('parseLine', () => {
  it('returns result on success', () => {
    const line = JSON.stringify({ id: 'abc', result: { type: 'ok', value: 1 } })
    expect(parseLine(line, 'abc')).toEqual({ type: 'ok', value: 1 })
  })

  it('throws HerdrError with code and message on error', () => {
    const line = JSON.stringify({ id: 'abc', error: { code: 'agent_blocked', message: 'nope' } })
    expect(() => parseLine(line, 'abc')).toThrow(HerdrError)
    try {
      parseLine(line, 'abc')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(HerdrError)
      expect((err as HerdrError).code).toBe('agent_blocked')
      expect((err as HerdrError).message).toBe('nope')
    }
  })

  it('throws bad_response on id mismatch', () => {
    const line = JSON.stringify({ id: 'other', result: {} })
    try {
      parseLine(line, 'abc')
      expect.unreachable()
    } catch (err) {
      expect((err as HerdrError).code).toBe('bad_response')
    }
  })

  it('throws bad_response on garbage JSON', () => {
    try {
      parseLine('not json', 'abc')
      expect.unreachable()
    } catch (err) {
      expect((err as HerdrError).code).toBe('bad_response')
    }
  })
})

describe('request', () => {
  let fake: FakeHerdr | undefined

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  it('resolves with the result on success', async () => {
    fake = await startFakeHerdr({
      'session.snapshot': () => ({ type: 'session_snapshot', snapshot: { version: '0.8.2' } }),
    })

    const result = await request(fake.socketPath, 'session.snapshot', {})
    expect(result).toEqual({ type: 'session_snapshot', snapshot: { version: '0.8.2' } })
    expect(fake.received).toEqual([{ method: 'session.snapshot', params: {} }])
  })

  it('rejects with HerdrError on an error line', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => ({ __error: { code: 'agent_blocked', message: 'agent is blocked' } }),
    })

    await expect(request(fake.socketPath, 'agent.prompt', { target: 'w1:p1', text: 'hi' })).rejects.toMatchObject({
      code: 'agent_blocked',
      message: 'agent is blocked',
    })
  })

  it('rejects with no_socket for ENOENT', async () => {
    await expect(request('/nonexistent/dir/herdr.sock', 'session.snapshot', {})).rejects.toMatchObject({
      code: 'no_socket',
    })
  })

  it('rejects with timeout when the handler never resolves', async () => {
    fake = await startFakeHerdr({
      'agent.prompt': () => new Promise(() => {}),
    })

    await expect(request(fake.socketPath, 'agent.prompt', {}, 200)).rejects.toMatchObject({
      code: 'timeout',
    })
  })
})

describe('subscribe', () => {
  let fake: FakeHerdr | undefined

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  it('delivers pushed events after the initial subscription response', async () => {
    fake = await startFakeHerdr({})

    const events: { event: string; data: Record<string, unknown> }[] = []
    const handle = subscribe(fake.socketPath, [{ type: 'pane.agent_status_changed', pane_id: 'w3F:p1' }], (event) => {
      events.push(event)
    })

    await new Promise((r) => setTimeout(r, 100))
    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w3F:p1', agent_status: 'idle' } })
    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w3F:p1', agent_status: 'working' } })
    await new Promise((r) => setTimeout(r, 100))

    expect(events).toEqual([
      { event: 'pane.agent_status_changed', data: { pane_id: 'w3F:p1', agent_status: 'idle' } },
      { event: 'pane.agent_status_changed', data: { pane_id: 'w3F:p1', agent_status: 'working' } },
    ])

    handle.close()
    handle.close() // does not throw
  })

  it('reports connection errors via onError', async () => {
    const errors: HerdrError[] = []
    const handle = subscribe('/nonexistent/dir/herdr.sock', [], () => {}, (err) => errors.push(err))

    await new Promise((r) => setTimeout(r, 100))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('no_socket')

    handle.close()
  })
})

describe('httpStatus', () => {
  it.each([
    ['invalid_params', 400],
    ['not_found', 404],
    ['agent_blocked', 409],
    ['busy', 503],
    ['unknown_code', 502],
    ['timeout', 502],
  ])('maps %s to %i', (code, status) => {
    expect(httpStatus(code)).toBe(status)
  })
})
