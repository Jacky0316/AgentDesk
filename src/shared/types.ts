export type ProviderKind = 'anthropic' | 'deepseek' | 'compatible'
export type TaskStatus = 'idle' | 'running' | 'waiting' | 'error' | 'completed' | 'archived'
export type PermissionMode = 'default' | 'acceptEdits' | 'dontAsk' | 'plan' | 'bypassPermissions' | 'auto'
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type WorkMode = 'explore' | 'build' | 'review' | 'fix'
export type DelegationMode = 'off' | 'ask' | 'auto'

export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  mainModel: string
  fastModel: string
  hasApiKey: boolean
  customHeaderNames: string[]
  capabilities: {
    thinking: boolean
    effort: boolean
    images: boolean
    structuredOutput: boolean
    toolUse: boolean
  }
  createdAt: string
  updatedAt: string
}

export interface ProviderInput extends Omit<ProviderProfile, 'hasApiKey' | 'customHeaderNames' | 'createdAt' | 'updatedAt'> {
  apiKey?: string
  customHeaders?: Record<string, string>
  preserveSecret?: boolean
}

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number
  model?: string
  message: string
}

export interface WorkspaceSummary {
  id: string
  path: string
  name: string
  lastOpenedAt: string
  isGit: boolean
}

export interface AgentDefinitionInput {
  description: string
  prompt: string
  tools?: string[]
  model?: string
}

export interface McpServerInput {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface TaskConfig {
  providerId: string
  model: string
  permissionMode: PermissionMode
  effort: EffortLevel
  thinking: 'adaptive' | 'disabled'
  maxTurns: number
  maxBudgetUsd: number
  /** User-visible task contract. Kept separate from advanced system instructions. */
  taskGoal: string
  acceptanceCriteria: string
  workMode: WorkMode
  delegationMode: DelegationMode
  maxConcurrentSubagents: number
  maxDelegatedSubagentsPerTurn: number
  /** Advanced, session-start-only instruction appended after the task contract. */
  systemPrompt: string
  tools: string[]
  includePartialMessages: boolean
  includeHookEvents: boolean
  forwardSubagentText: boolean
  enableFileCheckpointing: boolean
  outputSchema: Record<string, unknown> | null
  mcpServers: Record<string, McpServerInput>
  agents: Record<string, AgentDefinitionInput>
}

export interface TaskSummary {
  id: string
  title: string
  scope: 'standalone' | 'project'
  workspaceId: string | null
  workspacePath: string | null
  providerId: string
  sdkSessionId: string | null
  status: TaskStatus
  config: TaskConfig
  createdAt: string
  updatedAt: string
}

export interface StoredEvent {
  id: number
  taskId: string
  sequence: number
  kind: string
  payload: unknown
  createdAt: string
}

export interface PermissionPrompt {
  taskId: string
  requestId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  title: string
  description?: string
  agentId?: string
  risk: 'write' | 'command' | 'external' | 'unknown'
  createdAt: string
}

export interface RuntimeEvent {
  taskId: string
  sequence: number
  kind: 'sdk' | 'status' | 'permission' | 'error'
  payload: unknown
  createdAt: string
}

export interface DiffFile {
  path: string
  status: string
  insertions: number
  deletions: number
}

export interface DiffSnapshot {
  isGit: boolean
  files: DiffFile[]
  patch: string
  error?: string
}

export interface WorkspaceFileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: WorkspaceFileNode[]
}

export interface WorkspaceFilePreview {
  path: string
  content: string
  truncated: boolean
  binary: boolean
}

export interface ImageAttachmentInput {
  path: string
  name: string
}

export interface TerminalChunk {
  terminalId: string
  data: string
}

export interface AppBootstrap {
  providers: ProviderProfile[]
  workspaces: WorkspaceSummary[]
  tasks: TaskSummary[]
  sdkVersion: string
  platform: string
}

export interface AgentDeskApi {
  bootstrap(): Promise<AppBootstrap>
  chooseWorkspace(): Promise<WorkspaceSummary | null>
  removeWorkspace(workspaceId: string): Promise<void>
  createTask(input: { workspaceId: string; title?: string; config?: Partial<TaskConfig> }): Promise<TaskSummary>
  createStandaloneTask(input?: { title?: string; config?: Partial<TaskConfig> }): Promise<TaskSummary>
  updateTask(taskId: string, patch: { title?: string; config?: Partial<TaskConfig>; archived?: boolean }): Promise<TaskSummary>
  deleteTask(taskId: string): Promise<void>
  loadEvents(taskId: string): Promise<StoredEvent[]>
  sendMessage(taskId: string, input: { text: string; images?: ImageAttachmentInput[] }): Promise<void>
  stopTask(taskId: string): Promise<void>
  setPermissionMode(taskId: string, mode: PermissionMode): Promise<void>
  setModel(taskId: string, input: { providerId: string; model: string }): Promise<void>
  resolvePermission(input: { requestId: string; behavior: 'allow' | 'deny'; message?: string }): Promise<void>
  listProviders(): Promise<ProviderProfile[]>
  saveProvider(input: ProviderInput): Promise<ProviderProfile>
  deleteProvider(id: string): Promise<void>
  testProvider(id: string): Promise<ProviderTestResult>
  getDiff(taskId: string): Promise<DiffSnapshot>
  listWorkspaceFiles(taskId: string): Promise<WorkspaceFileNode[]>
  readWorkspaceFile(taskId: string, path: string): Promise<WorkspaceFilePreview>
  openFiles(): Promise<string[]>
  createTerminal(taskId: string): Promise<string>
  writeTerminal(terminalId: string, data: string): Promise<void>
  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void>
  closeTerminal(terminalId: string): Promise<void>
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void
  onTerminalData(listener: (event: TerminalChunk) => void): () => void
  onMenuCommand(listener: (command: 'new-task' | 'toggle-sidebar' | 'toggle-observer' | 'learn-more') => void): () => void
}

export const DEFAULT_TASK_CONFIG: TaskConfig = {
  providerId: 'deepseek',
  model: 'deepseek-v4-pro[1m]',
  permissionMode: 'default',
  effort: 'high',
  thinking: 'adaptive',
  maxTurns: 50,
  maxBudgetUsd: 10,
  taskGoal: '',
  acceptanceCriteria: '',
  workMode: 'build',
  delegationMode: 'ask',
  maxConcurrentSubagents: 2,
  maxDelegatedSubagentsPerTurn: 2,
  systemPrompt: '',
  tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'AskUserQuestion'],
  includePartialMessages: true,
  includeHookEvents: false,
  forwardSubagentText: false,
  enableFileCheckpointing: true,
  outputSchema: null,
  mcpServers: {},
  agents: {}
}
