import type { StoredEvent } from './types.js'

export type RunTimelineKind = 'user' | 'thinking' | 'tool' | 'tool-result' | 'approval' | 'approval-result' | 'status' | 'stderr' | 'error' | 'result'
export interface RunTimelineItem {
  key: string
  sequence: number
  kind: RunTimelineKind
  title: string
  summary: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  createdAt: string
  detail: unknown
}

export interface UsageSummary { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }

/** Extracts real Provider-reported usage only; it never estimates from text. */
export function buildUsageSummary(events: StoredEvent[]): UsageSummary {
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  for (const event of events) {
    const payload = event.payload as Record<string, any>
    const usage = payload?.usage ?? payload?.message?.usage ?? payload?.result?.usage
    if (!usage || typeof usage !== 'object') continue
    const input = usage.input_tokens ?? usage.inputTokens
    const output = usage.output_tokens ?? usage.outputTokens
    if (Number.isFinite(input)) inputTokens = Number(input)
    if (Number.isFinite(output)) outputTokens = Number(output)
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens !== null || outputTokens !== null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null }
}

const sensitiveField = /api[_-]?key|authorization|token|secret|password/i

/** Recursively masks credential-shaped fields before any renderer presentation. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sensitiveField.test(key) ? '[REDACTED]' : redactSensitive(item)]))
}

function compact(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, 150) || fallback
  if (value == null) return fallback
  try { return JSON.stringify(value).slice(0, 150) } catch { return fallback }
}

function fileName(value: unknown): string {
  const path = typeof value === 'string' ? value : ''
  return path.split(/[\\/]/).filter(Boolean).at(-1) || ''
}

export function localizedToolLabel(name: string, input?: unknown): string {
  const payload = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const target = fileName(payload.file_path ?? payload.path)
  const labels: Record<string, string> = { Read: '读取文件', Glob: '查找文件', Grep: '搜索项目内容', Bash: '执行项目命令', Edit: '编辑文件', Write: '写入文件', AskUserQuestion: '向你提问', TaskCreate: '创建执行计划', TaskUpdate: '更新计划进度', TaskGet: '查看计划状态', TaskList: '查看执行计划', Agent: '委派子任务' }
  const label = labels[name] ?? `调用 ${name}`
  return target && ['Read', 'Edit', 'Write'].includes(name) ? `${label}：${target}` : label
}

/** Maps persisted runtime events into an ordered, credential-safe observer timeline. */
export function buildRunTimeline(events: StoredEvent[]): RunTimelineItem[] {
  const rows: RunTimelineItem[] = []
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const payload = event.payload as Record<string, any> ?? {}
    const add = (kind: RunTimelineKind, title: string, summary: string, tone: RunTimelineItem['tone'] = 'neutral', detail: unknown = payload) => {
      rows.push({ key: `run-${event.sequence}-${rows.length}`, sequence: event.sequence, kind, title, summary, tone, createdAt: event.createdAt, detail: redactSensitive(detail) })
    }
    if (event.kind === 'status') { add('status', '任务状态', localizedStatus(String(payload.status ?? 'updated')), payload.status === 'error' ? 'danger' : payload.status === 'completed' ? 'success' : 'info'); continue }
    if (event.kind === 'permission') { add('approval', '等待你的确认', String(payload.title ?? payload.toolName ?? '需要确认的操作'), 'warning'); continue }
    if (event.kind === 'error') { add('error', '运行错误', compact(payload.message, '发生未知错误'), 'danger'); continue }
    if (event.kind === 'stderr') { add('stderr', '运行标准错误', compact(payload.data ?? payload.message, '标准错误输出'), 'warning'); continue }
    if (event.kind !== 'sdk') { add('result', '运行事件', compact(payload, '已收到运行事件')); continue }
    // Nested subagent transcripts are available only through the raw SDK
    // inspector; the normal observer presents their lifecycle status instead.
    if (payload.parent_tool_use_id) continue
    if (payload.type === 'app_user') { add('user', '你', compact(payload.text, '已发送消息'), 'info'); continue }
    // Stream deltas are transport-level fragments, often one row per token.
    // The observer shows completed replies and execution actions instead, so
    // it explains the Agent's work without flooding the timeline.
    if (payload.type === 'stream_event') continue
    if (payload.type === 'assistant') {
      for (const block of payload.message?.content ?? []) {
        if (block.type === 'tool_use') add('tool', localizedToolLabel(String(block.name ?? 'unknown'), block.input), compact(block.input, '已发起工具调用'), 'info', block)
        else if (block.type === 'text') add('result', '助手回复', compact(block.text, '回复已完成'), 'success', block)
      }
      continue
    }
    if (payload.type === 'user') {
      for (const block of payload.message?.content ?? []) if (block.type === 'tool_result') add('tool-result', block.is_error ? '工具调用失败' : '工具调用完成', compact(block.content, block.is_error ? '工具调用失败' : '工具调用完成'), block.is_error ? 'danger' : 'success', block)
      continue
    }
    if (/permission|approval/i.test(payload.type ?? '')) add('approval-result', '确认结果', compact(payload, '确认状态已更新'), 'success')
  }
  return rows
}

function localizedStatus(status: string): string {
  const labels: Record<string, string> = {
    running: '正在执行', idle: '本轮已完成', error: '本轮执行出错', waiting: '等待你的确认',
    plan_task_created: '已创建执行计划', plan_task_completed: '计划步骤已完成',
    subagent_running: '子任务执行中', subagent_completed: '子任务已完成',
    subagent_count_changed: '子任务数量已更新', budget_warning: '接近本轮预算上限',
    budget_increased: '已追加本轮预算', budget_continuation_declined: '未追加预算',
  }
  return labels[status] ?? status
}

export type ChatItem =
  | { type: 'user'; text: string; key: string }
  | { type: 'assistant'; text: string; key: string }
  | { type: 'tool'; name: string; input: unknown; key: string }
  | { type: 'tool-result'; content: string; error: boolean; key: string }
  | { type: 'error'; text: string; key: string }

export interface ChatTurn { key: string; user: Extract<ChatItem, { type: 'user' }>; items: Exclude<ChatItem, { type: 'user' }>[] }

/** Preserve turn order so execution feedback always sits between its user request and final answer. */
export function groupChatTurns(items: ChatItem[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  let current: ChatTurn | null = null
  for (const item of items) {
    if (item.type === 'user') {
      current = { key: item.key, user: item, items: [] }
      turns.push(current)
    } else if (current) current.items.push(item)
  }
  return turns
}

export interface ExecutionPlanItem {
  id: string
  description: string
  status: 'running' | 'completed'
  delegated: boolean
}

export interface BudgetWarning { spentUsd: number; budgetUsd: number }

export type VisibleEvent =
  | { type: 'narrative'; phase: 'intent' | 'finding' | 'summary' | 'final'; text: string; key: string }
  | { type: 'operation_group'; label: string; items: OperationItem[]; key: string }
  | { type: 'error'; summary: string; recoverable: boolean; key: string }

export type OperationItem =
  | { type: 'file_change'; path: string; action: 'read' | 'edit' | 'write' | 'search'; status: 'success' | 'failed'; key: string }
  | { type: 'command'; command: string; status: 'success' | 'failed'; key: string }
  | { type: 'delegation'; status: 'success' | 'failed'; key: string }

export interface VisibleActivityTurn {
  key: string
  user: string
  startedAt: string
  endedAt: string
  events: VisibleEvent[]
  final: string | null
}

function operationFromTool(name: string, input: unknown, key: string): OperationItem | null {
  const payload = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const path = String(payload.file_path ?? payload.path ?? '')
  if (['Read', 'Glob', 'Grep'].includes(name)) return { type: 'file_change', action: name === 'Read' ? 'read' : 'search', path: path || localizedToolLabel(name, input), status: 'success', key }
  if (name === 'Edit' || name === 'Write') return { type: 'file_change', action: name === 'Edit' ? 'edit' : 'write', path: path || localizedToolLabel(name, input), status: 'success', key }
  if (name === 'Bash') return { type: 'command', command: String(payload.command ?? '项目命令'), status: 'success', key }
  if (name === 'Agent') return { type: 'delegation', status: 'success', key }
  return null
}

function groupLabel(items: OperationItem[]): string {
  const hasChange = items.some((item) => item.type === 'file_change' && ['edit', 'write'].includes(item.action))
  const hasCommand = items.some((item) => item.type === 'command')
  const hasDelegation = items.some((item) => item.type === 'delegation')
  if (hasDelegation) return '委派了独立审查任务'
  if (hasChange && hasCommand) return '编辑了文件并运行了多个命令'
  if (hasChange) return '检查或编辑了项目文件'
  if (hasCommand) return '运行了多个命令'
  return '检查了项目配置'
}

/**
 * Converts raw SDK records into the compact narrative activity stream.  The
 * renderer never receives thinking deltas or forwarded child transcripts.
 */
export function buildVisibleActivityTurns(events: StoredEvent[]): VisibleActivityTurn[] {
  const turns: VisibleActivityTurn[] = []
  let current: VisibleActivityTurn | null = null
  let currentGroup: Extract<VisibleEvent, { type: 'operation_group' }> | null = null
  const closeGroup = (): void => { currentGroup = null }
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const payload = event.payload as Record<string, any> ?? {}
    if (event.kind === 'sdk' && payload.type === 'app_user') {
      current = { key: `visible-${event.sequence}`, user: String(payload.text ?? ''), startedAt: event.createdAt, endedAt: event.createdAt, events: [], final: null }
      turns.push(current); closeGroup(); continue
    }
    if (!current) continue
    current.endedAt = event.createdAt
    if (event.kind === 'error') { current.events.push({ type: 'error', summary: String(payload.message ?? '运行出错'), recoverable: true, key: `visible-error-${event.sequence}` }); closeGroup(); continue }
    if (event.kind !== 'sdk' || payload.parent_tool_use_id) continue
    if (payload.type === 'assistant') {
      for (const [index, block] of (payload.message?.content ?? []).entries()) {
        if (block.type === 'text' && block.text) { current.events.push({ type: 'narrative', phase: current.events.some((item) => item.type === 'operation_group') ? 'finding' : 'intent', text: String(block.text), key: `visible-narrative-${event.sequence}-${index}` }); closeGroup() }
        if (block.type === 'tool_use') {
          const operation = operationFromTool(String(block.name), block.input, `visible-operation-${event.sequence}-${index}`)
          if (!operation) continue
          if (!currentGroup) {
            currentGroup = { type: 'operation_group', label: '', items: [], key: `visible-group-${event.sequence}-${index}` }
            current.events.push(currentGroup)
          }
          currentGroup.items.push(operation)
          currentGroup.label = groupLabel(currentGroup.items)
        }
      }
      continue
    }
    if (payload.type === 'user' && Array.isArray(payload.message?.content)) {
      for (const block of payload.message.content) if (block.type === 'tool_result' && currentGroup?.items.length) {
        const latest = currentGroup.items.at(-1)
        if (latest && block.is_error) latest.status = 'failed'
        if (block.is_error) current.events.push({ type: 'error', summary: compact(textFromContent(block.content), '工具调用失败'), recoverable: true, key: `visible-tool-error-${event.sequence}` })
      }
    }
  }
  for (const turn of turns) {
    const lastNarrative = [...turn.events].reverse().find((event): event is Extract<VisibleEvent, { type: 'narrative' }> => event.type === 'narrative')
    if (lastNarrative) {
      turn.final = lastNarrative.text
      turn.events = turn.events.filter((event) => event.key !== lastNarrative.key)
    }
  }
  return turns
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => typeof block === 'object' && block && 'text' in block ? String((block as { text: unknown }).text) : '').join('')
}

function compactPlanDescription(value: unknown, fallback: string): string {
  const text = String(value ?? fallback).replace(/[`#*_]/g, '').replace(/\s+/g, ' ').trim()
  return text.length > 72 ? `${text.slice(0, 71)}…` : text || fallback
}

/** Maps persisted Claude Agent SDK events to the renderer's presentation model. */
export function buildChat(events: StoredEvent[]): { items: ChatItem[]; liveText: string; liveThinking: string; thinking: boolean; executionPlan: ExecutionPlanItem[]; budgetWarning: BudgetWarning | null } {
  const items: ChatItem[] = []
  const executionPlan = new Map<string, ExecutionPlanItem>()
  let liveText = ''
  let liveThinking = ''
  let thinking = false
  let budgetWarning: BudgetWarning | null = null
  for (const event of events) {
    const payload = event.payload as Record<string, any>
    if (event.kind === 'status') {
      const status = String(payload?.status ?? '')
      if (status === 'budget_warning' && Number.isFinite(payload?.spentUsd) && Number.isFinite(payload?.budgetUsd)) budgetWarning = { spentUsd: Number(payload.spentUsd), budgetUsd: Number(payload.budgetUsd) }
      if (status === 'budget_increased' || status === 'budget_continuation_declined') budgetWarning = null
      const delegated = status.startsWith('subagent_')
      const planned = status.startsWith('plan_task_')
      if (delegated || planned) {
        const id = String(payload?.taskId ?? `${delegated ? 'subagent' : 'plan'}-${event.sequence}`)
        const description = compactPlanDescription(payload?.description, delegated ? '执行受控委派' : '执行计划步骤')
        executionPlan.set(id, { id, description, delegated, status: status.endsWith('completed') ? 'completed' : 'running' })
      }
    }
    if (event.kind === 'error') items.push({ type: 'error', text: String(payload.message ?? '未知错误'), key: `error-${event.sequence}` })
    if (event.kind !== 'sdk') continue
    // The SDK marks forwarded subagent transcript messages with this field.
    // They belong in execution telemetry, never in the user's chat transcript.
    if (payload.parent_tool_use_id) continue
    if (payload.type === 'app_user') items.push({ type: 'user', text: String(payload.text), key: `user-${event.sequence}` })
    if (payload.type === 'stream_event') {
      if (payload.accumulated) {
        liveText = String(payload.accumulated.text ?? '')
        liveThinking = String(payload.accumulated.thinking ?? '')
        thinking = Boolean(liveThinking)
        continue
      }
      const delta = payload.event?.delta
      if (delta?.type === 'text_delta') liveText += String(delta.text ?? '')
      if (delta?.type === 'thinking_delta') { liveThinking += String(delta.text ?? ''); thinking = true }
    }
    if (payload.type === 'assistant') {
      liveText = ''
      liveThinking = ''
      thinking = false
      const blocks = payload.message?.content ?? []
      for (const [index, block] of blocks.entries()) {
        if (block.type === 'text' && block.text) items.push({ type: 'assistant', text: block.text, key: `assistant-${event.sequence}-${index}` })
        if (block.type === 'tool_use') items.push({ type: 'tool', name: block.name, input: block.input, key: `tool-${event.sequence}-${index}` })
      }
    }
    if (payload.type === 'user' && Array.isArray(payload.message?.content)) {
      for (const [index, block] of payload.message.content.entries()) {
        if (block.type === 'tool_result') items.push({ type: 'tool-result', content: textFromContent(block.content), error: Boolean(block.is_error), key: `tool-result-${event.sequence}-${index}` })
      }
    }
  }
  return { items, liveText, liveThinking, thinking, executionPlan: [...executionPlan.values()].slice(-8), budgetWarning }
}
