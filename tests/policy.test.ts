import { describe, expect, it } from 'vitest'
import { evaluateTool, isInsideWorkspace } from '../src/main/policy.js'

const workspace = 'D:\\demo\\workspace'

describe('workspace policy', () => {
  it('allows paths inside the active workspace and blocks escapes', () => {
    expect(isInsideWorkspace('src/index.ts', workspace)).toBe(true)
    expect(isInsideWorkspace('D:\\demo\\workspace\\README.md', workspace)).toBe(true)
    expect(isInsideWorkspace('D:\\demo\\outside.txt', workspace)).toBe(false)
    expect(evaluateTool('Read', { file_path: '..\\outside.txt' }, workspace)).toMatchObject({ action: 'deny' })
  })

  it('requires an approval for writes and ordinary commands in working mode', () => {
    expect(evaluateTool('Edit', { file_path: 'src/index.ts' }, workspace)).toMatchObject({ action: 'ask', risk: 'write' })
    expect(evaluateTool('Bash', { command: 'npm test' }, workspace)).toMatchObject({ action: 'ask', risk: 'command' })
  })

  it('hard blocks destructive commands and asks for external tools', () => {
    expect(evaluateTool('Bash', { command: 'Remove-Item -Recurse -Force .\\temp' }, workspace)).toMatchObject({ action: 'deny' })
    expect(evaluateTool('mcp__github__create_issue', {}, workspace)).toMatchObject({ action: 'ask', risk: 'external' })
  })

  it('uses the selected permission mode instead of natural-language intent', () => {
    expect(evaluateTool('Write', { file_path: 'snake.html' }, workspace, 'default')).toMatchObject({ action: 'ask', risk: 'write' })
    expect(evaluateTool('Write', { file_path: 'snake.html' }, workspace, 'acceptEdits')).toMatchObject({ action: 'allow' })
    expect(evaluateTool('Write', { file_path: 'snake.html' }, workspace, 'plan')).toMatchObject({ action: 'deny' })
    expect(evaluateTool('Read', { file_path: 'README.md' }, workspace, 'plan')).toMatchObject({ action: 'allow' })
    expect(evaluateTool('Bash', { command: 'git status --short' }, workspace, 'plan')).toMatchObject({ action: 'allow' })
    expect(evaluateTool('Bash', { command: 'npm test' }, workspace, 'plan')).toMatchObject({ action: 'deny' })
    expect(evaluateTool('mcp__github__create_issue', {}, workspace, 'plan')).toMatchObject({ action: 'deny' })
    expect(evaluateTool('mcp__minimax_web_search__web_search', {}, workspace, 'acceptEdits')).toMatchObject({ action: 'allow' })
    expect(evaluateTool('mcp__minimax_web_search__web_search', {}, workspace, 'default')).toMatchObject({ action: 'ask', risk: 'external' })
    expect(evaluateTool('Edit', { file_path: 'src/index.ts' }, workspace, 'dontAsk')).toMatchObject({ action: 'deny' })
  })

  it('allows internal SDK task tools without granting workspace access', () => {
    expect(evaluateTool('TaskCreate', { subject: 'Review the plan' }, workspace, 'dontAsk')).toMatchObject({ action: 'allow' })
    expect(evaluateTool('TaskList', {}, workspace, 'plan')).toMatchObject({ action: 'allow' })
  })
})
