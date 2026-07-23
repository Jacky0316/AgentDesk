import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRuntimeContext, buildSessionInstructions, buildTurnPrompt } from '../src/main/context-manager.js'
import { loadProjectInstructions } from '../src/main/project-instructions.js'
import { DEFAULT_TASK_CONFIG, type StoredEvent, type TaskSummary } from '../src/shared/types.js'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const task = (config = {}): TaskSummary => ({
  id: 'task-1', title: 'Review project', scope: 'project', workspaceId: 'workspace-1', workspacePath: 'D:\\work\\demo', providerId: 'deepseek', sdkSessionId: null, status: 'idle', createdAt: '', updatedAt: '', config: { ...DEFAULT_TASK_CONFIG, taskGoal: 'Review the provider setup', acceptanceCriteria: 'List verified risks', workMode: 'review', ...config }
})
const event = (sequence: number, payload: unknown): StoredEvent => ({ id: sequence, taskId: 'task-1', sequence, kind: 'sdk', payload, createdAt: '2026-07-22T00:00:00.000Z' })

describe('Agent context manager', () => {
  it('loads only the workspace-root AGENTS.md guidance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentdesk-agents-')); directories.push(directory)
    writeFileSync(join(directory, 'AGENTS.md'), '# Project rules\n- Run tests before handoff', 'utf8')
    expect(loadProjectInstructions(directory)).toMatchObject({ source: join(directory, 'AGENTS.md'), content: '# Project rules\n- Run tests before handoff' })
  })

  it('keeps platform, project, task, and advanced instructions in stable session order', () => {
    const instructions = buildSessionInstructions(task({ systemPrompt: 'Use compact tables.' }), { source: 'AGENTS.md', content: 'Use npm.cmd on Windows.' })
    expect(instructions).toMatch(/application policy is authoritative/)
    expect(instructions.indexOf('<project_rules')).toBeLessThan(instructions.indexOf('<task_contract>'))
    expect(instructions.indexOf('<task_contract>')).toBeLessThan(instructions.indexOf('<advanced_agent_instruction>'))
    expect(instructions).toContain('Work mode: review')
  })

  it('adds a bounded historical reminder before the latest user request', () => {
    const runtime = buildRuntimeContext([event(1, { type: 'assistant', message: { content: [{ type: 'text', text: 'The API key is stored safely.' }] } })])
    const prompt = buildTurnPrompt(runtime, 'Fix the provider test.')
    expect(prompt).toContain('The API key is stored safely.')
    expect(prompt.indexOf('<runtime_context>')).toBeLessThan(prompt.indexOf('<user_request>'))
    expect(prompt).toMatch(/<user_request>\nFix the provider test\.\n<\/user_request>$/)
  })
})
