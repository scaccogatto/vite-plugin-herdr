import { describe, it, expect, afterEach, vi } from 'vitest'
import { watchAgent, type StatusEvent } from '../server.ts'
import { startFakeHerdr } from './helpers/fake-herdr.ts'
import type { FakeHerdr } from './helpers/fake-herdr.ts'

describe('watchAgent', () => {
  let fake: FakeHerdr | undefined

  afterEach(async () => {
    await fake?.close()
    fake = undefined
  })

  it('forwards pushed events for the watched pane and ignores other panes', async () => {
    fake = await startFakeHerdr({})
    const events: StatusEvent[] = []
    const close = watchAgent((event) => events.push(event), fake.socketPath, 'w1:p1')

    await vi.waitFor(() => expect(fake?.subscriptionOpen()).toBe(true))

    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p2', agent_status: 'working' } })
    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p1', agent_status: 'working', title: 'Task' } })

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({ pane_id: 'w1:p1', agent_status: 'working', title: 'Task' })

    close()
  })

  it('closes the subscription after working then a settled status', async () => {
    fake = await startFakeHerdr({})
    const events: StatusEvent[] = []
    watchAgent((event) => events.push(event), fake.socketPath, 'w1:p1')

    await vi.waitFor(() => expect(fake?.subscriptionOpen()).toBe(true))

    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p1', agent_status: 'working', title: null } })
    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p1', agent_status: 'idle', title: 'Done' } })

    await vi.waitFor(() => expect(fake?.subscriptionOpen()).toBe(false))
    expect(events.map((e) => e.agent_status)).toEqual(['working', 'idle'])

    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p1', agent_status: 'working', title: null } })
    expect(events).toHaveLength(2)
  })

  it('closes after maxMs elapses', async () => {
    fake = await startFakeHerdr({})
    const events: StatusEvent[] = []
    watchAgent((event) => events.push(event), fake.socketPath, 'w1:p1', { maxMs: 50 })

    await vi.waitFor(() => expect(fake?.subscriptionOpen()).toBe(false), { timeout: 2000 })
    expect(events).toHaveLength(0)
  })

  it('the returned close function ends the watch early', async () => {
    fake = await startFakeHerdr({})
    const close = watchAgent(() => {}, fake.socketPath, 'w1:p1')

    await vi.waitFor(() => expect(fake?.subscriptionOpen()).toBe(true))
    close()
    await vi.waitFor(() => expect(fake?.subscriptionOpen()).toBe(false))
  })

  it('a second watch for the same pane closes the first', async () => {
    fake = await startFakeHerdr({})
    const firstEvents: StatusEvent[] = []
    const secondEvents: StatusEvent[] = []
    const subscribeCount = () => fake?.received.filter((r) => r.method === 'events.subscribe').length ?? 0

    watchAgent((event) => firstEvents.push(event), fake.socketPath, 'w1:p1')
    await vi.waitFor(() => expect(subscribeCount()).toBe(1))

    watchAgent((event) => secondEvents.push(event), fake.socketPath, 'w1:p1')
    // Wait for the second connection's events.subscribe to actually replace the
    // first on the fake: subscriptionOpen() alone could still read true from a
    // stale reference to the first (not-yet-closed) connection.
    await vi.waitFor(() => expect(subscribeCount()).toBe(2))

    fake.pushEvent({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p1', agent_status: 'working', title: null } })

    await vi.waitFor(() => expect(secondEvents).toHaveLength(1))
    expect(firstEvents).toHaveLength(0)
  })
})
