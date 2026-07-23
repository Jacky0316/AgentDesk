import { isAbsolute, normalize, relative, resolve } from 'node:path'
import type { PermissionMode } from '../shared/types.js'

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const COMMAND_TOOLS = new Set(['Bash', 'KillShell'])
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])

const destructivePatterns = [
  /\brm\s+-rf\b/i,
  /\bremove-item\b[^\r\n]*(?:-recurse|-force)/i,
  /\bformat(?:\.com)?\b/i,
  /\bdiskpart\b/i,
  /\bshutdown\b/i,
  /\breg(?:\.exe)?\s+delete\b/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\r\n]*f/i
]

function possiblePaths(input: Record<string, unknown>): string[] {
  const keys = ['file_path', 'path', 'notebook_path', 'directory']
  return keys.flatMap((key) => typeof input[key] === 'string' ? [input[key] as string] : [])
}

export function isInsideWorkspace(candidate: string, workspace: string): boolean {
  const absolute = normalize(isAbsolute(candidate) ? candidate : resolve(workspace, candidate))
  const rel = relative(normalize(workspace), absolute)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export type PolicyDecision =
  | { action: 'allow'; reason: string }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; reason: string; risk: 'write' | 'command' | 'external' | 'unknown' }

function isReadOnlyCommand(command: string): boolean {
  const value = command.trim().toLowerCase()
  // Do not accept compound commands in planning mode: a harmless prefix must
  // not be able to hide a later write behind `&&`, `;`, or a pipe.
  if (!value || /(?:&&|\|\||;|\||`|\$\(|>|<)/.test(value)) return false
  return /^(?:ls(?:\s|$)|dir(?:\s|$)|pwd$|get-location$|rg(?:\s|$)|grep(?:\s|$)|findstr(?:\s|$)|type(?:\s|$)|cat(?:\s|$)|get-content(?:\s|$)|git\s+(?:status|diff|log|show|branch)(?:\s|$))/.test(value)
}

/**
 * Enforce deterministic safety boundaries. The selected permission mode,
 * rather than natural-language intent detection, decides whether an action is
 * available. This keeps phrases such as “开发一下” from becoming a security
 * decision point.
 */
export function evaluateTool(toolName: string, input: Record<string, unknown>, workspace: string, permissionMode: PermissionMode = 'default'): PolicyDecision {
  if (toolName === 'AskUserQuestion') return { action: 'allow', reason: 'Clarifying questions do not access the workspace.' }
  if (TASK_TOOLS.has(toolName)) return { action: 'allow', reason: 'Internal execution-plan tools do not access the workspace.' }

  const paths = possiblePaths(input)
  if (paths.some((item) => !isInsideWorkspace(item, workspace))) {
    return { action: 'deny', reason: 'Tool target is outside the current workspace.' }
  }
  if (READ_TOOLS.has(toolName)) return { action: 'allow', reason: 'Read-only operation inside the workspace.' }

  if (permissionMode === 'dontAsk') {
    return { action: 'deny', reason: 'The current permission mode denies tools that are not explicitly pre-approved.' }
  }
  if (permissionMode === 'plan') {
    if (WRITE_TOOLS.has(toolName)) return { action: 'deny', reason: 'Planning mode does not allow workspace edits.' }
    if (COMMAND_TOOLS.has(toolName)) {
      const command = typeof input.command === 'string' ? input.command : ''
      if (toolName === 'Bash' && isReadOnlyCommand(command)) return { action: 'allow', reason: 'Read-only inspection command allowed in planning mode.' }
      return { action: 'deny', reason: 'Planning mode only allows read-only inspection commands.' }
    }
    if (toolName === 'Agent' || toolName.startsWith('mcp__')) {
      return { action: 'deny', reason: 'Planning mode does not allow subagents or external capabilities.' }
    }
  }

  if (toolName.startsWith('mcp__')) {
    if (permissionMode === 'acceptEdits') {
      return { action: 'allow', reason: 'Configured MCP capability is allowed by automatic-accept mode.' }
    }
    return { action: 'ask', reason: 'This tool may access an external capability.', risk: 'external' }
  }

  if (WRITE_TOOLS.has(toolName)) {
    if (permissionMode === 'acceptEdits' || permissionMode === 'auto' || permissionMode === 'bypassPermissions') {
      return { action: 'allow', reason: 'Workspace edit allowed by the active permission mode.' }
    }
    return { action: 'ask', reason: 'This tool will modify workspace files.', risk: 'write' }
  }
  if (COMMAND_TOOLS.has(toolName)) {
    const command = typeof input.command === 'string' ? input.command : JSON.stringify(input)
    if (destructivePatterns.some((pattern) => pattern.test(command))) return { action: 'deny', reason: 'Command matches a destructive-operation rule.' }
    if (permissionMode === 'acceptEdits' || permissionMode === 'auto' || permissionMode === 'bypassPermissions') {
      return { action: 'allow', reason: 'Command allowed by the active permission mode.' }
    }
    return { action: 'ask', reason: 'This tool will execute a local command.', risk: 'command' }
  }
  if (toolName === 'Agent') return { action: 'ask', reason: 'This tool may start a subagent or access an external capability.', risk: 'external' }
  return { action: 'ask', reason: 'Unknown tools require confirmation.', risk: 'unknown' }
}
