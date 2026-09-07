/** Bounding box of the element: position and dimensions */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Current viewport dimensions */
export interface Viewport {
  w: number
  h: number
}

/** Captured information about the picked DOM element */
export interface ElementInfo {
  url: string
  viewport: Viewport
  hint: string | null
  path: string
  rect: Rect
  html: string
  styles: Record<string, string>
}

/** Status of a herdr agent */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'

/** One herdr agent as shown in the popup */
export interface AgentRow {
  pane_id: string
  workspace_id: string
  agent_status: AgentStatus
  agent: string | null
  title: string | null
  branch: string | null
  session: string | null
  focused: boolean
  cwd: string | null
}

/** One herdr workspace */
export interface WorkspaceRow {
  workspace_id: string
  label: string | null
  number: number | null
  focused: boolean
}

/** Response from GET /__herdr/state */
export type StateResponse =
  | {
      herdr: true
      version: string
      protocol: number
      workspaceId: string | null
      paneId: string | null
      workspaces: WorkspaceRow[]
      agents: AgentRow[]
    }
  | { herdr: false; reason: string; message: string }

/** Request body for POST /__herdr/prompt */
export interface PromptRequest {
  target: string
  prompt: string
  element: ElementInfo
}

/** Successful response from POST /__herdr/prompt */
export interface PromptResponse {
  ok: true
  target: string
  title: string | null
  pane_id: string | null
}

/** Request body for POST /__herdr/spawn */
export interface SpawnRequest {
  mode: 'here' | 'worktree'
  name?: string
  branch?: string
}

/** Successful response from POST /__herdr/spawn */
export interface SpawnResponse {
  ok: true
  pane_id: string
  name: string
  workspace_id: string | null
}

/** Error response from the endpoints */
export interface ErrorResponse {
  error: string
  message: string
}

/** Options passed to the browser client */
export interface ClientOptions {
  hotkey: string
  endpoint: string
  maxDepth: number
  maxLines: number
}
