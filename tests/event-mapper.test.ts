import { describe, expect, it } from 'vitest'
import { buildChat, buildRunTimeline, buildUsageSummary, buildVisibleActivityTurns, redactSensitive } from '../src/shared/event-mapper.js'
import type { StoredEvent } from '../src/shared/types.js'

const event = (sequence: number, kind: string, payload: unknown): StoredEvent => ({ id: sequence, taskId: 'task-1', sequence, kind, payload, createdAt: '2026-07-19T00:00:00.000Z' })

describe('SDK event mapping', () => {
  it('accumulates a streamed response until a completed assistant message arrives', () => {
    const streaming = buildChat([
      event(1, 'sdk', { type: 'app_user', text: '你好' }),
      event(2, 'sdk', { type: 'stream_event', event: { delta: { type: 'thinking_delta' } } }),
      event(3, 'sdk', { type: 'stream_event', event: { delta: { type: 'text_delta', text: '正在' } } }),
      event(4, 'sdk', { type: 'stream_event', event: { delta: { type: 'text_delta', text: '回答' } } })
    ])
    expect(streaming.items).toEqual([{ type: 'user', text: '你好', key: 'user-1' }])
    expect(streaming).toMatchObject({ liveText: '正在回答', thinking: true })

    const completed = buildChat([
      event(5, 'sdk', { type: 'assistant', message: { content: [{ type: 'text', text: '完成回答' }, { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } }),
      event(6, 'sdk', { type: 'user', message: { content: [{ type: 'tool_result', content: 'file content', is_error: false }] } })
    ])
    expect(completed.items.map((item) => item.type)).toEqual(['assistant', 'tool', 'tool-result'])
    expect(completed).toMatchObject({ liveText: '', thinking: false })
  })

  it('makes persisted runtime errors visible in the transcript', () => {
    expect(buildChat([event(7, 'error', { message: 'network failed' })]).items).toEqual([{ type: 'error', text: 'network failed', key: 'error-7' }])
  })

  it('keeps forwarded subagent transcript text out of the user conversation', () => {
    const chat = buildChat([
      event(1, 'sdk', { type: 'assistant', parent_tool_use_id: 'call-child', message: { content: [{ type: 'text', text: 'English child transcript' }] } }),
      event(2, 'sdk', { type: 'assistant', message: { content: [{ type: 'text', text: 'Chinese parent answer' }] } })
    ])
    expect(chat.items).toEqual([{ type: 'assistant', text: 'Chinese parent answer', key: 'assistant-2-0' }])
  })

  it('shows SDK task lifecycle as a compact execution plan, not chat transcript', () => {
    const chat = buildChat([
      event(1, 'status', { status: 'plan_task_running', taskId: 'plan-1', description: 'Inspect the API contract' }),
      event(2, 'status', { status: 'subagent_running', taskId: 'delegate-1', description: 'Review independent risks', subagentType: 'general-purpose' }),
      event(3, 'status', { status: 'plan_task_completed', taskId: 'plan-1', description: 'Inspect the API contract' })
    ])
    expect(chat.items).toEqual([])
    expect(chat.executionPlan).toEqual([
      { id: 'plan-1', description: 'Inspect the API contract', delegated: false, status: 'completed' },
      { id: 'delegate-1', description: 'Review independent risks', delegated: true, status: 'running' }
    ])
  })

  it('builds an observer timeline without per-token stream fragments', () => {
    const timeline = buildRunTimeline([
      event(5, 'error', { message: 'network failed' }),
      event(1, 'sdk', { type: 'app_user', text: 'hello' }),
      event(2, 'sdk', { type: 'stream_event', event: { delta: { type: 'text_delta', text: 'working' } } }),
      event(3, 'sdk', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file: 'a.ts' } }] } }),
      event(4, 'permission', { title: 'Edit a.ts', token: 'never-show' }),
      event(6, 'status', { status: 'completed' })
    ])
    expect(timeline.map((item) => item.kind)).toEqual(['user', 'tool', 'approval', 'error', 'status'])
    expect(timeline[2].detail).toMatchObject({ token: '[REDACTED]' })
    expect(timeline.at(-1)?.tone).toBe('success')
  })

  it('keeps subagent transcript entries out of the normal observer timeline', () => {
    const timeline = buildRunTimeline([
      event(1, 'sdk', { type: 'assistant', parent_tool_use_id: 'call-child', message: { content: [{ type: 'text', text: 'child details' }] } }),
      event(2, 'status', { status: 'subagent_progress', description: 'Planning' })
    ])
    expect(timeline).toHaveLength(1)
    expect(timeline[0].summary).toBe('subagent_progress')
  })

  it('turns raw tool calls into a compact narrative activity stream', () => {
    const turns = buildVisibleActivityTurns([
      event(1, 'sdk', { type: 'app_user', text: '审查项目' }),
      event(2, 'sdk', { type: 'assistant', message: { content: [{ type: 'text', text: '我会先检查项目配置。' }, { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }, { type: 'tool_use', name: 'Bash', input: { command: 'npm.cmd test -- --run' } }] } }),
      event(3, 'sdk', { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok', is_error: false }] } }),
      event(4, 'sdk', { type: 'assistant', message: { content: [{ type: 'text', text: '审查完成，测试通过。' }] } }),
      event(5, 'sdk', { type: 'assistant', parent_tool_use_id: 'child', message: { content: [{ type: 'text', text: 'hidden child transcript' }] } })
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].final).toBe('审查完成，测试通过。')
    expect(turns[0].events).toMatchObject([
      { type: 'narrative', text: '我会先检查项目配置。' },
      { type: 'operation_group', label: '运行了多个命令' }
    ])
    expect(turns[0].events.some((item) => JSON.stringify(item).includes('hidden child transcript'))).toBe(false)
  })

  it('redacts nested credential-like fields without hiding ordinary values', () => {
    expect(redactSensitive({ apiKey: 'abc', nested: { authorization: 'Bearer secret', name: 'safe' }, tokens: 10 })).toEqual({ apiKey: '[REDACTED]', nested: { authorization: '[REDACTED]', name: 'safe' }, tokens: '[REDACTED]' })
  })

  it('uses only Provider-reported usage and leaves unavailable usage unknown', () => {
    expect(buildUsageSummary([event(1, 'sdk', { type: 'assistant', message: { usage: { input_tokens: 12, output_tokens: 8 } } })])).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20 })
    expect(buildUsageSummary([event(2, 'sdk', { type: 'assistant', message: {} })])).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null })
  })
})
