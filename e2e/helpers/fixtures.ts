/// Fixture: a raw herdr `session.snapshot` result (not a StateResponse) -
/// two workspaces, three agents: one idle, one working, one blocked
export const liveSnapshot = {
  type: 'session_snapshot',
  snapshot: {
    version: '0.8.2',
    protocol: '20',
    workspaces: [
      { workspace_id: 'w1', label: 'app', number: 1, focused: true },
      { workspace_id: 'w2', label: 'docs', number: 2, focused: false },
    ],
    agents: [
      {
        pane_id: 'w1:p2',
        workspace_id: 'w1',
        agent_status: 'idle',
        focused: false,
        agent: 'claude',
        cwd: null,
        terminal_title_stripped: 'Settings polish',
        tokens: { branch: ' main' },
        agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 's1' },
      },
      {
        pane_id: 'w1:p3',
        workspace_id: 'w1',
        agent_status: 'working',
        focused: false,
        agent: 'claude',
        cwd: null,
        terminal_title_stripped: 'Long task',
        tokens: { branch: ' main' },
        agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 's2' },
      },
      {
        pane_id: 'w2:p1',
        workspace_id: 'w2',
        agent_status: 'blocked',
        focused: false,
        agent: 'codex',
        cwd: null,
        terminal_title_stripped: 'Waiting',
        tokens: { branch: ' main' },
        agent_session: { source: 'herdr:codex', agent: 'codex', kind: 'id', value: 's3' },
      },
    ],
  },
}

/// Fixture: same as liveSnapshot but w1:p3 is idle too (both agents in the focused workspace pickable)
export const bothIdleSnapshot = {
  ...liveSnapshot,
  snapshot: {
    ...liveSnapshot.snapshot,
    agents: liveSnapshot.snapshot.agents.map((a) => (a.pane_id === 'w1:p3' ? { ...a, agent_status: 'idle' } : a)),
  },
}
