import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { query, type CanUseTool, type HookCallback, type PermissionResult, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'
import type { ImageAttachmentInput, PermissionPrompt, ProviderTestResult, RuntimeEvent, TaskSummary } from '../shared/types.js'
import { evaluateTool } from './policy.js'
import { providerEnvironment, withMiniMaxMcpCredentials } from './providers.js'
import { buildRuntimeContext, buildSessionInstructions, buildTurnPrompt } from './context-manager.js'
import { loadProjectInstructions } from './project-instructions.js'
import type { AppStore } from './store.js'

class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  private values: SDKUserMessage[] = []
  private waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = []
  private ended = false

  push(value: SDKUserMessage): void {
    if (this.ended) throw new Error('会话输入流已经关闭。')
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  end(): void {
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value) return Promise.resolve({ value, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      }
    }
  }
}

interface RuntimeSession {
  taskId: string
  queue: AsyncMessageQueue
  sdk: Query
  consuming: Promise<void>
  usageTimer?: NodeJS.Timeout
}

const EXECUTION_PLAN_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']
const AGENT_TOOL = 'Agent'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const imageMediaTypes: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

interface PendingPermission {
  taskId: string
  input: Record<string, unknown>
  resolve: (result: PermissionResult) => void
  reject: (error: Error) => void
  onAllow?: () => void | Promise<void>
  onDeny?: () => void | Promise<void>
}

interface StreamBuffer {
  text: string
  thinking: string
  timer?: NodeJS.Timeout
}

interface PreparedImage {
  name: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  bytes: number
  data: string
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class AgentRuntime {
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly streamBuffers = new Map<string, StreamBuffer>()
  private readonly backgroundTaskCounts = new Map<string, number>()
  private readonly delegationCounts = new Map<string, number>()
  private readonly subagentTaskIds = new Map<string, Set<string>>()
  private readonly delegationFinished = new Set<string>()
  private readonly budgetWarnings = new Set<string>()
  private readonly hostPlans = new Map<string, Array<{ id: string; description: string }>>()
  private liveSequence = 0

  constructor(
    private readonly store: AppStore,
    private readonly publish: (event: RuntimeEvent) => void,
    private readonly maxConcurrent = 3,
    private readonly standaloneWorkspace = process.cwd(),
    private readonly claudeExecutable?: string
  ) {}

  async send(taskId: string, text: string, images: ImageAttachmentInput[] = [], internal = false): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed && !images.length) return
    let task = this.store.getTask(taskId)
    if (!internal && trimmed && this.isUntitled(task.title)) {
      const updated = this.store.updateTask(taskId, { title: this.titleFromFirstPrompt(trimmed) })
      this.record(taskId, 'status', { status: 'title_changed', title: updated.title })
      task = updated
    }
    if (!internal && !task.config.taskGoal) task = this.store.updateTask(taskId, { config: { taskGoal: (trimmed || '分析用户附加的图片').slice(0, 1_500) } })
    if (!internal) {
      this.delegationCounts.set(taskId, 0)
      this.delegationFinished.delete(taskId)
    }
    const delegationRequested = !internal && task.config.delegationMode !== 'off' && this.isDelegationRequest(trimmed)
    if (delegationRequested && task.config.maxBudgetUsd === 10) task = this.store.updateTask(taskId, { config: { maxBudgetUsd: 30 } })
    if (!internal) this.startHostPlan(taskId, trimmed)
    const delegationApproved = !internal && this.shouldConfirmDelegation(task, trimmed)
      ? await this.confirmDelegationPlan(task, trimmed)
      : null
    let session = this.sessions.get(taskId)
    if (!session) session = await this.startSession(task)
    const runtimeContext = buildRuntimeContext(this.store.listEvents(taskId))
    const imageBlocks = internal ? [] : this.imageBlocks(task, images)
    if (!internal) this.record(taskId, 'sdk', { type: 'app_user', text: trimmed || '请分析我附加的图片。', images: imageBlocks.map((item) => ({ name: item.name, mediaType: item.mediaType, bytes: item.bytes })), timestamp: new Date().toISOString() })
    this.setStatus(taskId, 'running')
    session.queue.push({
      type: 'user',
      message: { role: 'user', content: this.userContent(runtimeContext, delegationApproved === null ? (trimmed || '请分析我附加的图片。') : `${trimmed}\n\n<delegation_decision>\nThe user ${delegationApproved ? 'approved' : 'declined'} read-only delegation for this turn. ${delegationApproved ? 'Use Agent only for the independent tracks requested, then synthesize the final answer yourself.' : 'Do not invoke Agent; complete the work directly.'}\n</delegation_decision>`, imageBlocks) },
      parent_tool_use_id: null,
      origin: { kind: 'human' }
    })
  }

  async interrupt(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId)
    if (!session) return
    await session.sdk.interrupt()
    this.setStatus(taskId, 'idle')
  }

  async setPermissionMode(taskId: string, mode: TaskSummary['config']['permissionMode']): Promise<void> {
    const session = this.sessions.get(taskId)
    if (session) await session.sdk.setPermissionMode(mode)
    this.store.updateTask(taskId, { config: { permissionMode: mode } })
    this.record(taskId, 'status', { status: 'config_changed', field: 'permissionMode', value: mode })
  }

  async setModel(taskId: string, input: { providerId: string; model: string }): Promise<void> {
    const task = this.store.getTask(taskId)
    if (task.status === 'running' || task.status === 'waiting') throw new Error('任务正在执行中，请在本轮结束后再切换模型。')
    const provider = this.store.getProvider(input.providerId)
    if (!provider.hasApiKey) throw new Error(`Provider “${provider.name}” 尚未配置 API Key。`)
    const session = this.sessions.get(taskId)
    const providerChanged = task.config.providerId !== input.providerId
    if (providerChanged && session) {
      session.queue.end()
      session.sdk.close()
      this.sessions.delete(taskId)
    }
    else if (session) await session.sdk.setModel(input.model)
    this.store.updateTask(taskId, { config: { providerId: input.providerId, model: input.model }, sdkSessionId: providerChanged ? null : undefined })
    this.record(taskId, 'status', { status: 'config_changed', field: providerChanged ? 'providerAndModel' : 'model', providerId: input.providerId, providerName: provider.name, value: input.model, sessionReset: providerChanged })
  }

  async resolvePermission(requestId: string, behavior: 'allow' | 'deny', message?: string): Promise<void> {
    const pending = this.permissions.get(requestId)
    if (!pending) throw new Error('审批请求已过期或不存在。')
    this.permissions.delete(requestId)
    if (behavior === 'allow') {
      await pending.onAllow?.()
      pending.resolve({ behavior: 'allow', updatedInput: pending.input })
    }
    else {
      await pending.onDeny?.()
      pending.resolve({ behavior: 'deny', message: message || '用户拒绝了该工具调用。' })
    }
    if (!pending.onDeny || behavior === 'allow') this.setStatus(pending.taskId, 'running')
    this.record(pending.taskId, 'status', { status: 'permission_resolved', requestId, behavior })
  }

  async testProvider(providerId: string): Promise<ProviderTestResult> {
    const provider = this.store.getProvider(providerId)
    const secret = this.store.getProviderSecret(providerId)
    if (!secret.apiKey) return { ok: false, latencyMs: 0, message: '请先保存 API Key。' }
    const started = Date.now()
    try {
      const probe = query({
        prompt: 'Reply with exactly: OK',
        options: {
          cwd: process.cwd(),
          env: providerEnvironment(provider, secret.apiKey, secret.customHeaders),
          model: provider.mainModel || undefined,
          pathToClaudeCodeExecutable: this.claudeExecutable,
          tools: [],
          maxTurns: 1,
          persistSession: false,
          settingSources: [],
          systemPrompt: 'You are a connectivity probe. Follow the user instruction exactly.'
        }
      })
      let response = ''
      for await (const message of probe) {
        if (message.type === 'assistant') {
          response += message.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
        }
        if (message.type === 'result' && message.is_error) {
          const errors = 'errors' in message ? message.errors : []
          throw new Error(errors.join('; ') || message.subtype)
        }
      }
      return { ok: /OK/i.test(response), latencyMs: Date.now() - started, model: provider.mainModel, message: response.trim() || '连接成功。' }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, model: provider.mainModel, message: errorMessage(error) }
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.queue.end()
      session.sdk.close()
    }
    this.sessions.clear()
    this.backgroundTaskCounts.clear()
    for (const buffer of this.streamBuffers.values()) if (buffer.timer) clearTimeout(buffer.timer)
    this.streamBuffers.clear()
    for (const pending of this.permissions.values()) pending.reject(new Error('应用正在关闭。'))
    this.permissions.clear()
  }

  private async startSession(task: TaskSummary): Promise<RuntimeSession> {
    if (this.sessions.size >= this.maxConcurrent) throw new Error(`最多同时运行 ${this.maxConcurrent} 个任务，请先停止一个任务。`)
    const provider = this.store.getProvider(task.config.providerId)
    const secret = this.store.getProviderSecret(provider.id)
    if (!secret.apiKey) throw new Error(`Provider “${provider.name}” 尚未配置 API Key。`)

    const queue = new AsyncMessageQueue()
    const canUseTool = this.permissionHandler(task)
    const cwd = task.workspacePath ?? this.standaloneWorkspace
    const projectInstructions = loadProjectInstructions(task.workspacePath)
    if (task.scope === 'standalone') mkdirSync(cwd, { recursive: true })
    const primaryModel = task.config.model || provider.mainModel || undefined
    const fallbackModel = provider.fastModel.trim() && provider.fastModel.trim() !== primaryModel ? provider.fastModel.trim() : undefined
    const sdk = query({
      prompt: queue,
      options: {
        cwd,
        pathToClaudeCodeExecutable: this.claudeExecutable,
        env: providerEnvironment(provider, secret.apiKey, secret.customHeaders),
        model: primaryModel,
        // The SDK rejects a fallback identical to the selected main model.
        fallbackModel,
        resume: task.sdkSessionId || undefined,
        title: task.title,
        tools: task.scope === 'project'
          ? [...new Set([...task.config.tools, 'AskUserQuestion', ...EXECUTION_PLAN_TOOLS, ...(task.config.delegationMode === 'off' ? [] : [AGENT_TOOL])])].filter((tool) => provider.kind === 'anthropic' || !['WebSearch', 'WebFetch'].includes(tool))
          : [...new Set([...task.config.tools, ...EXECUTION_PLAN_TOOLS, ...(task.config.delegationMode === 'off' ? [] : [AGENT_TOOL])])],
        allowedTools: [],
        canUseTool,
        hooks: {
          PreToolUse: [{ hooks: [this.preToolUseHandler(task)] }]
        },
        permissionMode: task.config.permissionMode,
        allowDangerouslySkipPermissions: task.config.permissionMode === 'bypassPermissions',
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: withMiniMaxMcpCredentials(task.config.mcpServers, provider, secret.apiKey),
        agents: task.config.agents,
        includePartialMessages: task.config.includePartialMessages,
        includeHookEvents: task.config.includeHookEvents,
        forwardSubagentText: task.config.forwardSubagentText,
        enableFileCheckpointing: task.config.enableFileCheckpointing,
        effort: task.config.effort,
        thinking: task.config.thinking === 'adaptive' ? { type: 'adaptive' } : { type: 'disabled' },
        maxTurns: task.config.maxTurns,
        maxBudgetUsd: task.config.maxBudgetUsd,
        outputFormat: task.config.outputSchema ? { type: 'json_schema', schema: task.config.outputSchema } : undefined,
        systemPrompt: buildSessionInstructions(task, projectInstructions),
        sandbox: { enabled: true, failIfUnavailable: false },
        stderr: (data) => this.record(task.id, 'sdk', { type: 'stderr', data })
      }
    })

    const session: RuntimeSession = { taskId: task.id, queue, sdk, consuming: Promise.resolve() }
    session.consuming = this.consume(session)
    session.usageTimer = setInterval(() => { void this.checkBudgetUsage(session) }, 5_000)
    this.sessions.set(task.id, session)
    return session
  }

  private async consume(session: RuntimeSession): Promise<void> {
    try {
      for await (const message of session.sdk) this.handleSdkMessage(session.taskId, message)
    } catch (error) {
      this.record(session.taskId, 'error', { message: errorMessage(error), stack: error instanceof Error ? error.stack : undefined })
      this.setStatus(session.taskId, 'error')
    } finally {
      if (session.usageTimer) clearInterval(session.usageTimer)
      if (this.sessions.get(session.taskId) === session) this.sessions.delete(session.taskId)
    }
  }

  private handleSdkMessage(taskId: string, message: SDKMessage): void {
    const safe = jsonSafe(message)
    if (message.type === 'stream_event') {
      if (this.isForwardedSubagentMessage(safe as Record<string, unknown>)) return
      this.queueStream(taskId, safe as unknown as Record<string, unknown>)
      return
    }
    if (message.type === 'system' && this.handleSystemTelemetry(taskId, safe as Record<string, unknown>)) return
    if (this.isForwardedSubagentMessage(safe as Record<string, unknown>)) return
    this.flushStream(taskId)
    this.record(taskId, 'sdk', this.safeForStore(safe as Record<string, unknown>))
    if (message.type === 'assistant' || message.type === 'result') this.clearStream(taskId)
    if (message.type === 'system' && message.subtype === 'init') {
      this.store.updateTask(taskId, { sdkSessionId: message.session_id })
    }
    if (message.type === 'result') {
      if (message.is_error) {
        const errors = Array.isArray((message as { errors?: unknown[] }).errors) ? (message as { errors: unknown[] }).errors.map(String).join('; ') : ''
        const subtype = String((message as { subtype?: string }).subtype ?? 'error')
        if (subtype === 'error_max_budget_usd') this.requestBudgetContinuation(taskId, Number((message as { total_cost_usd?: number }).total_cost_usd ?? 0))
        else {
          this.record(taskId, 'error', { message: errors || `SDK execution failed: ${subtype}`, subtype })
          this.setStatus(taskId, 'error')
        }
      }
      else if ((this.backgroundTaskCounts.get(taskId) ?? 0) === 0) {
        this.completeHostPlan(taskId)
        this.setStatus(taskId, 'idle')
      }
    }
  }

  private isForwardedSubagentMessage(message: Record<string, unknown>): boolean {
    return typeof message.parent_tool_use_id === 'string' && message.parent_tool_use_id.length > 0
  }

  /** Keep high-frequency SDK telemetry out of the synchronous event store. */
  private handleSystemTelemetry(taskId: string, message: Record<string, unknown>): boolean {
    const subtype = String(message.subtype ?? '')
    if (subtype === 'thinking_tokens' || subtype === 'status') return true
    if (subtype === 'background_tasks_changed') {
      const tasks = Array.isArray(message.tasks) ? message.tasks as Array<Record<string, unknown>> : []
      const previousCount = this.backgroundTaskCounts.get(taskId) ?? 0
      this.backgroundTaskCounts.set(taskId, tasks.length)
      if (tasks.length > 0) this.setStatus(taskId, 'running')
      if (previousCount > 0 && tasks.length === 0) {
        this.delegationFinished.add(taskId)
        this.record(taskId, 'status', { status: 'subagents_all_completed' })
      }
      // This is a changing aggregate, not a new child task. Rendering it as
      // subagent_running created a duplicate row on every lifecycle update.
      if (previousCount !== tasks.length) this.record(taskId, 'status', { status: 'subagent_count_changed', count: tasks.length })
      return true
    }
    if (subtype === 'task_started' || subtype === 'task_progress') {
      const delegated = Boolean(message.subagent_type)
      const sdkTaskId = typeof message.task_id === 'string' ? message.task_id : undefined
      if (delegated && sdkTaskId) {
        const ids = this.subagentTaskIds.get(taskId) ?? new Set<string>()
        ids.add(sdkTaskId)
        this.subagentTaskIds.set(taskId, ids)
      }
      this.record(taskId, 'status', {
        status: delegated ? (subtype === 'task_started' ? 'subagent_running' : 'subagent_progress') : (subtype === 'task_started' ? 'plan_task_running' : 'plan_task_progress'),
        taskId: sdkTaskId,
        description: String(message.description ?? (delegated ? 'Subagent is working' : 'Execution task is working')),
        subagentType: delegated ? String(message.subagent_type) : undefined,
        toolName: typeof message.last_tool_name === 'string' ? message.last_tool_name : undefined
      })
      return true
    }
    if (subtype === 'task_notification' || subtype === 'task_updated') {
      const sdkTaskId = typeof message.task_id === 'string' ? message.task_id : undefined
      const delegated = Boolean(message.subagent_type) || Boolean(sdkTaskId && this.subagentTaskIds.get(taskId)?.has(sdkTaskId))
      this.record(taskId, 'status', {
        status: delegated ? 'subagent_completed' : 'plan_task_completed',
        taskId: sdkTaskId,
        // Child summaries can be multi-page model output. They belong in the
        // raw observer trace, not the compact conversation activity surface.
        description: delegated ? '子任务已完成，等待主 Agent 汇总' : String(message.description ?? message.status ?? '执行计划步骤已完成')
      })
      return true
    }
    return false
  }

  /** Coalesce token-sized SDK events before crossing Electron IPC. */
  private queueStream(taskId: string, message: Record<string, unknown>): void {
    const delta = (message.event as { delta?: { type?: string; text?: string } } | undefined)?.delta
    if (delta?.type !== 'text_delta' && delta?.type !== 'thinking_delta') return
    const buffer = this.streamBuffers.get(taskId) ?? { text: '', thinking: '' }
    if (delta.type === 'text_delta') buffer.text += delta.text ?? ''
    if (delta.type === 'thinking_delta') buffer.thinking += delta.text ?? ''
    this.streamBuffers.set(taskId, buffer)
    if (!buffer.timer) buffer.timer = setTimeout(() => this.flushStream(taskId), 120)
  }

  private flushStream(taskId: string): void {
    const buffer = this.streamBuffers.get(taskId)
    if (!buffer) return
    if (buffer.timer) clearTimeout(buffer.timer)
    buffer.timer = undefined
    if (!buffer.text && !buffer.thinking) return
    this.publish({
      taskId,
      sequence: -(++this.liveSequence),
      kind: 'sdk',
      payload: { type: 'stream_event', accumulated: { text: buffer.text, thinking: buffer.thinking } },
      createdAt: new Date().toISOString()
    })
  }

  private clearStream(taskId: string): void {
    const buffer = this.streamBuffers.get(taskId)
    if (buffer?.timer) clearTimeout(buffer.timer)
    this.streamBuffers.delete(taskId)
  }

  private isUntitled(title: string): boolean {
    return title === 'New task' || title.startsWith('New task in ')
  }

  /** User-selected images are a direct message input, not a workspace tool read. */
  private imageBlocks(task: TaskSummary, images: ImageAttachmentInput[]): PreparedImage[] {
    if (!images.length) return []
    const provider = this.store.getProvider(task.config.providerId)
    if (!provider.capabilities.images) throw new Error(`当前模型“${provider.name} / ${task.config.model || provider.mainModel}”未声明图片理解能力。请切换到支持图片的模型后重试。`)
    return images.map((image) => {
      const extension = extname(image.name || image.path).toLowerCase()
      const mediaType = imageMediaTypes[extension]
      if (!mediaType) throw new Error(`不支持图片格式：${image.name}。请使用 PNG、JPG、GIF 或 WebP。`)
      const stat = statSync(image.path)
      if (!stat.isFile()) throw new Error(`无法读取图片文件：${image.name}`)
      if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片“${image.name}”超过 10 MB，请压缩后重试。`)
      return { name: image.name, mediaType, bytes: stat.size, data: readFileSync(image.path).toString('base64') }
    })
  }

  private userContent(runtimeContext: string, userText: string, images: PreparedImage[]): MessageParam['content'] {
    const prompt = buildTurnPrompt(runtimeContext, userText)
    if (!images.length) return prompt
    return [
      { type: 'text', text: `${prompt}\n\n<image_input>用户已附加 ${images.length} 张图片。请直接基于图片内容完成请求；不要把本地文件路径当作可调用工具路径。</image_input>` },
      ...images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.data } }))
    ]
  }

  /** Image bytes are transient transport data and must never be stored in event history. */
  private safeForStore(message: Record<string, unknown>): Record<string, unknown> {
    const copy = jsonSafe(message)
    const envelope = copy.message as { content?: unknown[] } | undefined
    if (!Array.isArray(envelope?.content)) return copy
    envelope.content = envelope.content.map((block) => {
      if (!block || typeof block !== 'object' || (block as { type?: unknown }).type !== 'image') return block
      const source = (block as { source?: { media_type?: unknown } }).source
      return { type: 'image', source: { type: 'base64', media_type: source?.media_type ?? 'unknown', data: '[图片数据未持久化]' } }
    })
    return copy
  }

  private titleFromFirstPrompt(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    return normalized.length > 36 ? `${normalized.slice(0, 35)}…` : normalized
  }

  private permissionHandler(task: TaskSummary): CanUseTool {
    return async (toolName, input, options): Promise<PermissionResult> => {
      const currentTask = this.store.getTask(task.id)
      const delegation = this.delegationDecision(currentTask, toolName, input)
      if (delegation) {
        if (toolName === AGENT_TOOL && delegation.behavior === 'allow') this.noteDelegation(task.id)
        return delegation
      }
      const decision = currentTask.scope === 'standalone'
        ? toolName.startsWith('mcp__')
          ? currentTask.config.permissionMode === 'acceptEdits'
            ? { action: 'allow' as const, reason: 'Configured MCP capability is allowed by automatic-accept mode.' }
            : { action: 'ask' as const, reason: 'Standalone tasks require approval before using an external MCP capability.', risk: 'external' as const }
          : { action: 'deny' as const, reason: 'Standalone tasks cannot access files or commands.', risk: 'unknown' as const }
        : evaluateTool(toolName, input, currentTask.workspacePath ?? '', currentTask.config.permissionMode)
      if (decision.action === 'allow') return { behavior: 'allow', updatedInput: input }
      if (decision.action === 'deny') {
        this.record(task.id, 'status', { status: 'policy_denied', toolName, toolUseId: options.toolUseID, reason: decision.reason })
        return { behavior: 'deny', message: decision.reason }
      }

      const requestId = randomUUID()
      const isDelegation = toolName === AGENT_TOOL
      const prompt: PermissionPrompt = {
        taskId: task.id,
        requestId,
        toolUseId: options.toolUseID,
        toolName,
        input: jsonSafe(input),
        title: options.title || `${toolName} 请求执行`,
        description: options.description || decision.reason,
        agentId: options.agentID,
        risk: decision.risk,
        createdAt: new Date().toISOString(),
        ...(isDelegation ? { title: '委派计划需要确认', description: '主 Agent 请求委派一个独立、只读的子任务；最终回答仍由主 Agent 汇总。' } : {})
      }
      this.setStatus(task.id, 'waiting')
      this.record(task.id, 'permission', prompt)
      return await new Promise<PermissionResult>((resolve, reject) => {
        this.permissions.set(requestId, { taskId: task.id, input, resolve, reject, onAllow: isDelegation ? () => this.noteDelegation(task.id) : undefined })
        options.signal.addEventListener('abort', () => {
          if (!this.permissions.delete(requestId)) return
          reject(new Error('工具审批已取消。'))
        }, { once: true })
      })
    }
  }

  private preToolUseHandler(task: TaskSummary): HookCallback {
    return async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return { continue: true }
      const toolInput = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
        ? input.tool_input as Record<string, unknown>
        : {}
      const currentTask = this.store.getTask(task.id)
      if (this.delegationFinished.has(task.id) && (input.tool_name === 'TaskCreate' || input.tool_name === 'TaskUpdate')) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'All delegated reviews have completed. Do not create or update more plan tasks; synthesize their findings and return the final answer now.'
          }
        }
      }
      if (input.tool_name === 'Agent' && currentTask.config.delegationMode === 'off') {
        this.record(task.id, 'status', { status: 'policy_denied', toolName: input.tool_name, toolUseId: input.tool_use_id, reason: 'Delegation is disabled for this task.' })
        return { continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Delegation is disabled for this task.' } }
      }
      const decision = currentTask.scope === 'standalone'
        ? input.tool_name.startsWith('mcp__')
          ? currentTask.config.permissionMode === 'acceptEdits'
            ? { action: 'allow' as const, reason: 'Configured MCP capability is allowed by automatic-accept mode.' }
            : { action: 'ask' as const, reason: 'Standalone tasks require approval before using an external MCP capability.' }
          : { action: 'deny' as const, reason: 'Standalone tasks cannot access files or commands.' }
        : evaluateTool(input.tool_name, toolInput, currentTask.workspacePath ?? '', currentTask.config.permissionMode)
      if (decision.action !== 'deny') return { continue: true }

      this.record(task.id, 'status', { status: 'policy_denied', toolName: input.tool_name, toolUseId: input.tool_use_id, reason: decision.reason })
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason
        }
      }
    }
  }

  private delegationDecision(task: TaskSummary, toolName: string, input: Record<string, unknown>): PermissionResult | null {
    if (toolName !== 'Agent') return null
    if (task.config.delegationMode === 'off') return { behavior: 'deny', message: 'Delegation is disabled for this task.' }
    if (task.config.delegationMode === 'auto' && !['explore', 'review'].includes(task.config.workMode)) {
      return { behavior: 'deny', message: 'Automatic delegation is limited to explore or review work. Ask for approval in build and fix work.' }
    }
    if ((this.backgroundTaskCounts.get(task.id) ?? 0) >= task.config.maxConcurrentSubagents) {
      return { behavior: 'deny', message: `This task has reached its ${task.config.maxConcurrentSubagents} concurrent-subagent limit.` }
    }
    if ((this.delegationCounts.get(task.id) ?? 0) >= task.config.maxDelegatedSubagentsPerTurn) {
      return { behavior: 'deny', message: `This turn has reached its ${task.config.maxDelegatedSubagentsPerTurn} delegation limit.` }
    }
    if (task.config.delegationMode === 'auto') return { behavior: 'allow', updatedInput: input }
    return null
  }

  private noteDelegation(taskId: string): void {
    this.delegationCounts.set(taskId, (this.delegationCounts.get(taskId) ?? 0) + 1)
  }

  private async checkBudgetUsage(session: RuntimeSession): Promise<void> {
    if (this.budgetWarnings.has(session.taskId)) return
    try {
      const usage = await session.sdk.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
      const spent = usage.session?.total_cost_usd
      const budget = this.store.getTask(session.taskId).config.maxBudgetUsd
      if (typeof spent !== 'number' || spent < budget * 0.8 || spent >= budget) return
      this.budgetWarnings.add(session.taskId)
      this.record(session.taskId, 'status', { status: 'budget_warning', spentUsd: spent, budgetUsd: budget })
    } catch {
      // Some compatible providers do not expose live cost telemetry.
    }
  }

  private requestBudgetContinuation(taskId: string, spentUsd: number): void {
    const task = this.store.getTask(taskId)
    const requestId = randomUUID()
    const nextBudget = task.config.maxBudgetUsd + 20
    const prompt: PermissionPrompt = {
      taskId,
      requestId,
      toolUseId: `budget-continuation-${requestId}`,
      toolName: 'BudgetContinuation',
      input: { spentUsd, currentBudgetUsd: task.config.maxBudgetUsd, nextBudgetUsd: nextBudget },
      title: '本轮预算已达上限',
      description: `已使用 $${spentUsd.toFixed(2)} / $${task.config.maxBudgetUsd.toFixed(2)}。是否将本轮上限提升至 $${nextBudget.toFixed(2)} 并继续？`,
      risk: 'external',
      createdAt: new Date().toISOString()
    }
    this.setStatus(taskId, 'waiting')
    this.record(taskId, 'permission', prompt)
    this.permissions.set(requestId, {
      taskId,
      input: prompt.input,
      resolve: () => undefined,
      reject: () => undefined,
      onAllow: async () => {
        this.store.updateTask(taskId, { config: { maxBudgetUsd: nextBudget } })
        this.budgetWarnings.delete(taskId)
        this.record(taskId, 'status', { status: 'budget_increased', previousBudgetUsd: task.config.maxBudgetUsd, budgetUsd: nextBudget })
        await this.send(taskId, 'Continue the interrupted task from the available session context. Do not repeat completed work; finish the remaining work and provide the final answer.', [], true)
      },
      onDeny: () => {
        this.completeHostPlan(taskId)
        this.setStatus(taskId, 'idle')
        this.record(taskId, 'status', { status: 'budget_continuation_declined' })
      }
    })
  }

  private isDelegationRequest(request: string): boolean {
    return /并行|分别(?:审查|分析|梳理)|同时.*(?:分析|审查|检查)|独立(?:研究|审查|分析)|子\s*agent|子任务/i.test(request)
  }

  private shouldConfirmDelegation(task: TaskSummary, request: string): boolean {
    return task.config.delegationMode === 'ask' && this.isDelegationRequest(request)
  }

  /** A deterministic preflight for an explicitly parallel user request. */
  private async confirmDelegationPlan(task: TaskSummary, request: string): Promise<boolean> {
    const requestId = randomUUID()
    const prompt: PermissionPrompt = {
      taskId: task.id,
      requestId,
      toolUseId: `delegation-preflight-${requestId}`,
      toolName: AGENT_TOOL,
      input: { request: request.slice(0, 500), maxConcurrentSubagents: task.config.maxConcurrentSubagents, maxDelegatedSubagentsPerTurn: task.config.maxDelegatedSubagentsPerTurn },
      title: '委派计划需要确认',
      description: `该请求包含并行工作。最多并发 ${task.config.maxConcurrentSubagents} 个子 Agent，本轮最多委派 ${task.config.maxDelegatedSubagentsPerTurn} 个；最终答案由主 Agent 汇总。`,
      risk: 'external',
      createdAt: new Date().toISOString()
    }
    this.setStatus(task.id, 'waiting')
    this.record(task.id, 'permission', prompt)
    const result = await new Promise<PermissionResult>((resolve, reject) => this.permissions.set(requestId, { taskId: task.id, input: prompt.input, resolve, reject }))
    return result.behavior === 'allow'
  }

  /** Create a small host-visible plan even if the model elects not to call TaskCreate. */
  private startHostPlan(taskId: string, request: string): void {
    const steps = this.explicitPlanSteps(request)
    // A plan is a user-visible coordination surface, not a thinking trace.
    // Do not create one unless the request itself names at least two work items.
    if (steps.length < 2) return
    const plan = steps.map((description) => ({ id: `host-${randomUUID()}`, description }))
    this.hostPlans.set(taskId, plan)
    for (const [index, item] of plan.entries()) {
      this.record(taskId, 'status', { status: index === 0 ? 'plan_task_running' : 'plan_task_pending', taskId: item.id, description: item.description, source: 'host' })
    }
  }

  private explicitPlanSteps(request: string): string[] {
    const normalized = request.replace(/\s+/g, ' ').trim()
    const parallel = normalized.match(/(?:并行|分别|同时)(?:审查|分析|梳理|检查)?(.+?)(?:和|、|及|以及)(.+?)(?:，|,|；|;|。|$)/)
    if (parallel) {
      const left = parallel[1].trim().slice(0, 32)
      const right = parallel[2].trim().slice(0, 32)
      return [`处理：${left}`, `处理：${right}`, '汇总结论']
    }
    const numbered = [...normalized.matchAll(/(?:^|[；;\n])\s*(?:\d+[.、]|[-*])\s*([^；;\n]+)/g)].map((match) => match[1].trim().slice(0, 48)).filter(Boolean)
    if (numbered.length >= 2) return numbered.slice(0, 4)
    const sequential = normalized.match(/(?:先|首先)(.+?)(?:再|然后)(.+?)(?:，|,|；|;|。|$)/)
    if (sequential) return [`${sequential[1].trim().slice(0, 48)}`, `${sequential[2].trim().slice(0, 48)}`]
    return []
  }

  private completeHostPlan(taskId: string): void {
    const plan = this.hostPlans.get(taskId)
    if (!plan) return
    for (const item of plan) this.record(taskId, 'status', { status: 'plan_task_completed', taskId: item.id, description: item.description, source: 'host' })
    this.hostPlans.delete(taskId)
  }

  private setStatus(taskId: string, status: TaskSummary['status']): void {
    this.store.updateTask(taskId, { status })
    this.record(taskId, 'status', { status })
  }

  private record(taskId: string, kind: RuntimeEvent['kind'], payload: unknown): void {
    const stored = this.store.appendEvent(taskId, kind, jsonSafe(payload))
    this.publish({ taskId, sequence: stored.sequence, kind, payload: stored.payload, createdAt: stored.createdAt })
  }
}
