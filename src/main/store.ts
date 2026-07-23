import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { safeStorage } from 'electron'
import { DEFAULT_TASK_CONFIG, type ProviderInput, type ProviderProfile, type StoredEvent, type TaskConfig, type TaskStatus, type TaskSummary, type WorkspaceSummary } from '../shared/types.js'
import { providerPresets } from './providers.js'

interface SecretBundle { apiKey: string; customHeaders: Record<string, string> }
interface ProviderRow { id: string; name: string; kind: ProviderProfile['kind']; baseUrl: string; mainModel: string; fastModel: string; capabilities: ProviderProfile['capabilities']; encryptedSecret?: string; createdAt: string; updatedAt: string }
interface TaskRow extends Omit<TaskSummary, 'workspacePath'> {}
interface PersistedData { providers: ProviderRow[]; workspaces: WorkspaceSummary[]; tasks: TaskRow[]; events: StoredEvent[]; nextEventId: number }
const emptyData = (): PersistedData => ({ providers: [], workspaces: [], tasks: [], events: [], nextEventId: 1 })

export class AppStore {
  private data: PersistedData
  constructor(private readonly path: string) { this.data = this.load(); this.seedProviders() }
  close(): void { this.persist() }
  private load(): PersistedData {
    try {
      if (!existsSync(this.path)) return emptyData()
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<PersistedData>
      const tasks = (parsed.tasks ?? []).map((task) => ({
        ...task,
        scope: task.scope ?? (task.workspaceId ? 'project' : 'standalone'),
        workspaceId: task.workspaceId ?? null,
        config: { ...DEFAULT_TASK_CONFIG, ...(task.config ?? {}) }
      })) as TaskRow[]
      return { ...emptyData(), ...parsed, providers: parsed.providers ?? [], workspaces: parsed.workspaces ?? [], tasks, events: parsed.events ?? [] }
    } catch { return emptyData() }
  }
  private persist(): void { mkdirSync(dirname(this.path), { recursive: true }); const temp = `${this.path}.tmp`; writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8'); renameSync(temp, this.path) }
  private seedProviders(): void { for (const preset of providerPresets) if (!this.data.providers.some((item) => item.id === preset.id)) this.saveProvider(preset) }
  private mapProvider(row: ProviderRow): ProviderProfile { const secret = row.encryptedSecret ? this.decryptSecret(row.encryptedSecret) : { apiKey: '', customHeaders: {} }; return { ...row, hasApiKey: Boolean(secret.apiKey), customHeaderNames: Object.keys(secret.customHeaders) } }
  listProviders(): ProviderProfile[] { return [...this.data.providers].sort((a, b) => a.kind === 'anthropic' ? -1 : b.kind === 'anthropic' ? 1 : a.name.localeCompare(b.name)).map((row) => this.mapProvider(row)) }
  getProvider(id: string): ProviderProfile { const row = this.data.providers.find((item) => item.id === id); if (!row) throw new Error(`Provider not found: ${id}`); return this.mapProvider(row) }
  saveProvider(input: ProviderInput): ProviderProfile {
    const index = this.data.providers.findIndex((item) => item.id === input.id); const previous = index >= 0 ? this.data.providers[index] : undefined
    const secret = previous?.encryptedSecret ? this.decryptSecret(previous.encryptedSecret) : { apiKey: '', customHeaders: {} }; const now = new Date().toISOString()
    const writeSecret = !input.preserveSecret || input.apiKey !== undefined || input.customHeaders !== undefined
    const row: ProviderRow = { id: input.id, name: input.name, kind: input.kind, baseUrl: input.baseUrl.replace(/\/$/, ''), mainModel: input.mainModel, fastModel: input.fastModel, capabilities: input.capabilities, encryptedSecret: writeSecret ? this.encryptSecret({ apiKey: input.apiKey ?? secret.apiKey, customHeaders: input.customHeaders ?? secret.customHeaders }) : previous?.encryptedSecret, createdAt: previous?.createdAt ?? now, updatedAt: now }
    if (index >= 0) this.data.providers[index] = row; else this.data.providers.push(row); this.persist(); return this.mapProvider(row)
  }
  deleteProvider(id: string): void { if (id === 'anthropic' || id === 'deepseek') throw new Error('Built-in Provider cannot be deleted.'); if (this.data.tasks.some((task) => task.providerId === id)) throw new Error('Provider is used by a task.'); this.data.providers = this.data.providers.filter((item) => item.id !== id); this.persist() }
  getProviderSecret(id: string): SecretBundle { const row = this.data.providers.find((item) => item.id === id); return row?.encryptedSecret ? this.decryptSecret(row.encryptedSecret) : { apiKey: '', customHeaders: {} } }
  private encryptSecret(value: SecretBundle): string | undefined { if (!value.apiKey && !Object.keys(value.customHeaders).length) return undefined; if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage unavailable.'); return safeStorage.encryptString(JSON.stringify(value)).toString('base64') }
  private decryptSecret(value: string): SecretBundle { if (!safeStorage.isEncryptionAvailable()) return { apiKey: '', customHeaders: {} }; try { return JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64'))) as SecretBundle } catch { return { apiKey: '', customHeaders: {} } } }
  upsertWorkspace(path: string, isGit: boolean): WorkspaceSummary { const existing = this.data.workspaces.find((item) => item.path === path); const row = { id: existing?.id ?? randomUUID(), path, name: basename(path), lastOpenedAt: new Date().toISOString(), isGit }; if (existing) Object.assign(existing, row); else this.data.workspaces.push(row); this.persist(); return row }
  getWorkspace(id: string): WorkspaceSummary { const row = this.data.workspaces.find((item) => item.id === id); if (!row) throw new Error(`Workspace not found: ${id}`); return row }
  listWorkspaces(): WorkspaceSummary[] { return [...this.data.workspaces].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)) }
  removeWorkspace(id: string): void {
    if (!this.data.workspaces.some((item) => item.id === id)) throw new Error('Project not found.')
    this.data.workspaces = this.data.workspaces.filter((item) => item.id !== id)
    for (const task of this.data.tasks.filter((item) => item.workspaceId === id)) { task.scope = 'standalone'; task.workspaceId = null; task.config = { ...task.config, tools: [] }; task.updatedAt = new Date().toISOString() }
    this.persist()
  }
  private mergedConfig(config?: Partial<TaskConfig>, standalone = false): TaskConfig { const provider = this.listProviders().find((item) => item.id === DEFAULT_TASK_CONFIG.providerId) ?? this.listProviders()[0]; if (!provider) throw new Error('Configure a Provider first.'); return { ...DEFAULT_TASK_CONFIG, providerId: provider.id, model: provider.mainModel || DEFAULT_TASK_CONFIG.model, ...config, tools: standalone ? config?.tools ?? [] : config?.tools ?? DEFAULT_TASK_CONFIG.tools } }
  createTask(workspaceId: string, title?: string, config?: Partial<TaskConfig>): TaskSummary { const workspace = this.getWorkspace(workspaceId); const now = new Date().toISOString(); const merged = this.mergedConfig(config); const row: TaskRow = { id: randomUUID(), title: title || `New task in ${workspace.name}`, scope: 'project', workspaceId, providerId: merged.providerId, sdkSessionId: null, status: 'idle', config: merged, createdAt: now, updatedAt: now }; this.data.tasks.push(row); this.persist(); return { ...row, workspacePath: workspace.path } }
  createStandaloneTask(title?: string, config?: Partial<TaskConfig>): TaskSummary { const now = new Date().toISOString(); const merged = this.mergedConfig(config, true); const row: TaskRow = { id: randomUUID(), title: title || 'New task', scope: 'standalone', workspaceId: null, providerId: merged.providerId, sdkSessionId: null, status: 'idle', config: merged, createdAt: now, updatedAt: now }; this.data.tasks.push(row); this.persist(); return { ...row, workspacePath: null } }
  getTask(id: string): TaskSummary { const row = this.data.tasks.find((item) => item.id === id); if (!row) throw new Error(`Task not found: ${id}`); return { ...row, scope: row.scope ?? (row.workspaceId ? 'project' : 'standalone'), workspacePath: row.workspaceId ? this.getWorkspace(row.workspaceId).path : null } }
  listTasks(includeArchived = false): TaskSummary[] { return this.data.tasks.filter((item) => includeArchived || item.status !== 'archived').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => this.getTask(item.id)) }
  updateTask(id: string, patch: { title?: string; config?: Partial<TaskConfig>; status?: TaskStatus; sdkSessionId?: string | null }): TaskSummary { const row = this.data.tasks.find((item) => item.id === id); if (!row) throw new Error(`Task not found: ${id}`); if (patch.config) row.config = { ...row.config, ...patch.config }; row.title = patch.title ?? row.title; row.providerId = row.config.providerId; row.sdkSessionId = patch.sdkSessionId === undefined ? row.sdkSessionId : patch.sdkSessionId; row.status = patch.status ?? row.status; row.updatedAt = new Date().toISOString(); this.persist(); return this.getTask(id) }
  appendEvent(taskId: string, kind: string, payload: unknown): StoredEvent { const sequence = this.data.events.filter((item) => item.taskId === taskId).reduce((max, item) => Math.max(max, item.sequence), 0) + 1; const row: StoredEvent = { id: this.data.nextEventId++, taskId, sequence, kind, payload, createdAt: new Date().toISOString() }; this.data.events.push(row); const task = this.data.tasks.find((item) => item.id === taskId); if (task) task.updatedAt = row.createdAt; this.persist(); return row }
  listEvents(taskId: string): StoredEvent[] { return this.data.events.filter((item) => item.taskId === taskId).sort((a, b) => a.sequence - b.sequence) }
  deleteTask(id: string): void { if (!this.data.tasks.some((item) => item.id === id)) throw new Error('Task not found.'); this.data.tasks = this.data.tasks.filter((item) => item.id !== id); this.data.events = this.data.events.filter((item) => item.taskId !== id); this.persist() }
}
