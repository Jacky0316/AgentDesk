import { create } from 'zustand'
import { DEFAULT_TASK_CONFIG, type DiffSnapshot, type ImageAttachmentInput, type PermissionMode, type PermissionPrompt, type ProviderInput, type ProviderProfile, type StoredEvent, type TaskConfig, type TaskSummary, type WorkspaceSummary } from '../../shared/types'

type RightPanel = 'none' | 'run' | 'files' | 'changes' | 'terminal' | 'lab' | 'providers'
type AppDrawer = 'none' | 'lab' | 'providers'

interface UiState {
  loading: boolean
  error: string | null
  sdkVersion: string
  workspaces: WorkspaceSummary[]
  tasks: TaskSummary[]
  providers: ProviderProfile[]
  activeTaskId: string | null
  events: Record<string, StoredEvent[]>
  permissions: PermissionPrompt[]
  rightPanel: RightPanel
  appDrawer: AppDrawer
  sidebarVisible: boolean
  diff: DiffSnapshot | null
  bootstrap: () => Promise<void>
  setError: (error: string | null) => void
  setRightPanel: (panel: RightPanel) => void
  setAppDrawer: (drawer: AppDrawer) => void
  setSidebarVisible: (visible: boolean) => void
  chooseWorkspace: () => Promise<WorkspaceSummary | null>
  removeWorkspace: (workspaceId: string) => Promise<void>
  createTask: (workspaceId?: string) => Promise<void>
  createStandaloneTask: () => Promise<void>
  selectTask: (taskId: string) => Promise<void>
  send: (input: { text: string; images?: ImageAttachmentInput[] }) => Promise<void>
  stop: () => Promise<void>
  updateTask: (patch: { title?: string; config?: Partial<TaskConfig> }) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  setModel: (input: { providerId: string; model: string }) => Promise<void>
  resolvePermission: (requestId: string, behavior: 'allow' | 'deny') => Promise<void>
  saveProvider: (input: ProviderInput) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  refreshDiff: () => Promise<void>
}

const failure = (error: unknown): string => error instanceof Error ? error.message : String(error)
const MAX_RENDERED_EVENTS = 400

export const useAppStore = create<UiState>((set, get) => ({
  loading: true,
  error: null,
  sdkVersion: '',
  workspaces: [],
  tasks: [],
  providers: [],
  activeTaskId: null,
  events: {},
  permissions: [],
  rightPanel: 'run',
  appDrawer: 'none',
  sidebarVisible: true,
  diff: null,

  bootstrap: async () => {
    try {
      const data = await window.agentDesk.bootstrap()
      set({ ...data, activeTaskId: data.tasks[0]?.id ?? null, rightPanel: data.tasks[0] ? 'run' : 'none', loading: false })
      if (data.tasks[0]) await get().selectTask(data.tasks[0].id)
      window.agentDesk.onRuntimeEvent((event) => {
        const stored: StoredEvent = { id: -event.sequence, taskId: event.taskId, sequence: event.sequence, kind: event.kind, payload: event.payload, createdAt: event.createdAt }
        set((state) => {
          const current = state.events[event.taskId] ?? []
          if (event.kind === 'sdk' && (event.payload as { type?: string }).type === 'stream_event') {
            const previous = current.at(-1)
            const payload = event.payload as { accumulated?: { text?: string; thinking?: string }; event?: { delta?: { type?: string; text?: string } } }
            // The main process sends a throttled cumulative snapshot. Replacing
            // the prior live event avoids copying and re-rendering token by token.
            if (payload.accumulated) {
              const streamEvent = { ...stored, payload }
              return { events: { ...state.events, [event.taskId]: previous?.kind === 'sdk' && (previous.payload as { type?: string }).type === 'stream_event' ? [...current.slice(0, -1), streamEvent] : [...current, streamEvent] } }
            }
            if (previous?.kind === 'sdk' && (previous.payload as { type?: string }).type === 'stream_event') {
              const previousPayload = previous.payload as { accumulated?: { text?: string; thinking?: string } }
              const delta = payload.event?.delta
              const accumulated = { ...previousPayload.accumulated }
              if (delta?.type === 'text_delta') accumulated.text = `${accumulated.text ?? ''}${delta.text ?? ''}`
              if (delta?.type === 'thinking_delta') accumulated.thinking = `${accumulated.thinking ?? ''}${delta.text ?? ''}`
              const merged = { ...stored, payload: { ...payload, accumulated } }
              return { events: { ...state.events, [event.taskId]: [...current.slice(0, -1), merged] } }
            }
            const delta = payload.event?.delta
            const accumulated = { text: delta?.type === 'text_delta' ? delta.text ?? '' : '', thinking: delta?.type === 'thinking_delta' ? delta.text ?? '' : '' }
            return { events: { ...state.events, [event.taskId]: [...current, { ...stored, payload: { ...payload, accumulated } }] } }
          }
          return { events: { ...state.events, [event.taskId]: [...current, stored] } }
        })
        if (event.kind === 'permission') set((state) => ({ permissions: [...state.permissions, event.payload as PermissionPrompt] }))
        if (event.kind === 'status') {
          const status = (event.payload as { status?: TaskSummary['status'] }).status
          if (status && ['idle', 'running', 'waiting', 'error', 'completed', 'archived'].includes(status)) {
            set((state) => ({ tasks: state.tasks.map((task) => task.id === event.taskId ? { ...task, status } : task) }))
          }
          const title = (event.payload as { title?: string }).title
          if (title) set((state) => ({ tasks: state.tasks.map((task) => task.id === event.taskId ? { ...task, title } : task) }))
        }
      })
    } catch (error) { set({ loading: false, error: failure(error) }) }
  },

  setError: (error) => set({ error }),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setAppDrawer: (appDrawer) => set({ appDrawer }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),

  chooseWorkspace: async () => {
    try {
      const workspace = await window.agentDesk.chooseWorkspace()
      if (workspace) set((state) => ({ workspaces: [workspace, ...state.workspaces.filter((item) => item.id !== workspace.id)] }))
      return workspace
    } catch (error) { set({ error: failure(error) }); return null }
  },

  removeWorkspace: async (workspaceId) => {
    try {
      await window.agentDesk.removeWorkspace(workspaceId)
      set((state) => ({ workspaces: state.workspaces.filter((item) => item.id !== workspaceId), tasks: state.tasks.map((task) => task.workspaceId === workspaceId ? { ...task, scope: 'standalone', workspaceId: null, workspacePath: null, config: { ...task.config, tools: [] } } : task) }))
    } catch (error) { set({ error: failure(error) }) }
  },

  createTask: async (workspaceId) => {
    try {
      let target = workspaceId ? get().workspaces.find((item) => item.id === workspaceId) : get().workspaces[0]
      if (!target) target = await get().chooseWorkspace() ?? undefined
      if (!target) return
      const provider = get().providers.find((item) => item.id === DEFAULT_TASK_CONFIG.providerId) ?? get().providers[0]
      const task = await window.agentDesk.createTask({ workspaceId: target.id, config: provider ? { providerId: provider.id, model: provider.mainModel || DEFAULT_TASK_CONFIG.model } : undefined })
      set((state) => ({ tasks: [task, ...state.tasks], activeTaskId: task.id, rightPanel: 'run', events: { ...state.events, [task.id]: [] } }))
    } catch (error) { set({ error: failure(error) }) }
  },

  createStandaloneTask: async () => {
    try {
      const provider = get().providers.find((item) => item.id === DEFAULT_TASK_CONFIG.providerId) ?? get().providers[0]
      const task = await window.agentDesk.createStandaloneTask({ config: provider ? { providerId: provider.id, model: provider.mainModel || DEFAULT_TASK_CONFIG.model } : undefined })
      set((state) => ({ tasks: [task, ...state.tasks], activeTaskId: task.id, rightPanel: 'run', events: { ...state.events, [task.id]: [] } }))
    } catch (error) { set({ error: failure(error) }) }
  },

  selectTask: async (taskId) => {
    set({ activeTaskId: taskId })
    if (get().events[taskId]) return
    try {
      const events = await window.agentDesk.loadEvents(taskId)
      set((state) => ({ events: { ...state.events, [taskId]: events.slice(-MAX_RENDERED_EVENTS) } }))
    } catch (error) { set({ error: failure(error) }) }
  },

  send: async (input) => {
    const taskId = get().activeTaskId
    if (!taskId) return
    try { await window.agentDesk.sendMessage(taskId, input) }
    catch (error) { set({ error: failure(error) }) }
  },

  stop: async () => {
    const taskId = get().activeTaskId
    if (!taskId) return
    try { await window.agentDesk.stopTask(taskId) }
    catch (error) { set({ error: failure(error) }) }
  },

  updateTask: async (patch) => {
    const taskId = get().activeTaskId
    if (!taskId) return
    try {
      const task = await window.agentDesk.updateTask(taskId, patch)
      set((state) => ({ tasks: state.tasks.map((item) => item.id === task.id ? task : item) }))
    } catch (error) { set({ error: failure(error) }) }
  },

  deleteTask: async (taskId) => {
    try {
      await window.agentDesk.deleteTask(taskId)
      set((state) => ({ tasks: state.tasks.filter((item) => item.id !== taskId), events: Object.fromEntries(Object.entries(state.events).filter(([id]) => id !== taskId)), activeTaskId: state.activeTaskId === taskId ? state.tasks.find((item) => item.id !== taskId)?.id ?? null : state.activeTaskId }))
    } catch (error) { set({ error: failure(error) }) }
  },

  setPermissionMode: async (mode) => {
    const taskId = get().activeTaskId
    if (!taskId) return
    try {
      await window.agentDesk.setPermissionMode(taskId, mode)
      set((state) => ({ tasks: state.tasks.map((task) => task.id === taskId ? { ...task, config: { ...task.config, permissionMode: mode } } : task) }))
    } catch (error) { set({ error: failure(error) }) }
  },

  setModel: async (input) => {
    const taskId = get().activeTaskId
    if (!taskId) return
    try {
      await window.agentDesk.setModel(taskId, input)
      set((state) => ({ tasks: state.tasks.map((task) => task.id === taskId ? { ...task, providerId: input.providerId, config: { ...task.config, providerId: input.providerId, model: input.model }, sdkSessionId: task.config.providerId === input.providerId ? task.sdkSessionId : null } : task) }))
    } catch (error) { set({ error: failure(error) }) }
  },

  resolvePermission: async (requestId, behavior) => {
    try {
      await window.agentDesk.resolvePermission({ requestId, behavior })
      set((state) => ({ permissions: state.permissions.filter((item) => item.requestId !== requestId) }))
    } catch (error) { set({ error: failure(error) }) }
  },

  saveProvider: async (input) => {
    try {
      const provider = await window.agentDesk.saveProvider(input)
      set((state) => ({ providers: [...state.providers.filter((item) => item.id !== provider.id), provider] }))
      await Promise.all(get().tasks.filter((task) => task.providerId === provider.id).map(async (task) => {
        const updated = await window.agentDesk.updateTask(task.id, { config: { model: provider.mainModel } })
        set((state) => ({ tasks: state.tasks.map((item) => item.id === updated.id ? updated : item) }))
      }))
    } catch (error) { set({ error: failure(error) }); throw error }
  },

  deleteProvider: async (id) => {
    try {
      await window.agentDesk.deleteProvider(id)
      set((state) => ({ providers: state.providers.filter((item) => item.id !== id) }))
    } catch (error) { set({ error: failure(error) }) }
  },

  refreshDiff: async () => {
    const taskId = get().activeTaskId
    if (!taskId) return
    try { set({ diff: await window.agentDesk.getDiff(taskId) }) }
    catch (error) { set({ error: failure(error) }) }
  }
}))
