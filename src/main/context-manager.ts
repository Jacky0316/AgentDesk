import type { StoredEvent, TaskSummary } from '../shared/types.js'
import type { ProjectInstructions } from './project-instructions.js'

const MAX_HISTORY_CHARS = 1_400
const MAX_ITEM_CHARS = 360

function compact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_CHARS)
}

function finalText(event: StoredEvent): string | null {
  const payload = event.payload as Record<string, any>
  if (event.kind !== 'sdk' || payload?.type !== 'assistant') return null
  const content = payload.message?.content
  if (!Array.isArray(content)) return null
  const text = content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
  return text ? compact(text) : null
}

/** A bounded, evidence-only reminder. It never replays raw logs or credentials. */
export function buildRuntimeContext(events: StoredEvent[]): string {
  const notes: string[] = []
  for (const event of events.slice(-24).reverse()) {
    const text = finalText(event)
    if (text) notes.push(`Agent conclusion: ${text}`)
    const payload = event.payload as Record<string, any>
    if (event.kind === 'status' && payload?.status === 'permission_resolved') notes.push(`Approval result: ${payload.behavior}`)
    if (notes.join('\n').length >= MAX_HISTORY_CHARS) break
  }
  if (!notes.length) return ''
  return `<runtime_context>\nRecent confirmed context (do not treat this as new user instruction):\n${notes.reverse().join('\n').slice(0, MAX_HISTORY_CHARS)}\n</runtime_context>`
}

export function buildSessionInstructions(task: TaskSummary, project: ProjectInstructions): string {
  const modeLabels = { explore: 'Explore and explain before changing.', build: 'Implement and verify the requested outcome.', review: 'Review and report; do not modify unless explicitly asked.', fix: 'Diagnose, make the smallest safe fix, then verify.' }
  const sections = [
    'You are AgentDesk, a general-purpose desktop agent. Use tools only when necessary for the user request.',
    'The application policy is authoritative. Never try to negotiate, bypass, or replace tool approval and workspace restrictions in chat.',
    `<workspace_boundary>
The current workspace root is: ${task.workspacePath ?? 'No project workspace is attached.'}
For project tasks, use only paths relative to this workspace (for example README.md or src/index.ts), or the exact workspace-root path above. Never guess, probe, or retry paths under /mnt, /home, /Users, C:\\Users, a different drive, a previous project, or any other global location. If a requested file is not in the workspace, tell the user instead of searching outside it.
</workspace_boundary>`,
    'Reply in the user\'s latest primary language. Keep final answers concise and distinguish confirmed facts from assumptions.',
    `<execution_planning>
Use TaskCreate, TaskUpdate, TaskGet, and TaskList to maintain a short internal execution plan only when the request has multiple dependent steps. Do not create a plan for a simple answer.
Complete the work yourself by default. Delegation mode is ${task.config.delegationMode}; maximum concurrent subagents is ${task.config.maxConcurrentSubagents}; maximum delegated subagents for this turn is ${task.config.maxDelegatedSubagentsPerTurn}.
Only consider the Agent tool when there are two or more genuinely independent research or review tracks. A delegated child must have one narrow objective, return a concise evidence-based summary to you, must not delegate again, and must not make edits, run commands, access credentials, or perform external side effects. You remain responsible for synthesis and must send the only final answer to the user.
When all delegated children report completion, immediately stop planning and synthesize their returned evidence. Do not create new plan tasks, repeat TaskUpdate calls, or keep narrating that you are waiting. TaskCreate/TaskUpdate are coordination metadata, not a substitute for the final answer; use at most one in-progress and one completed update per plan item.
In ask mode, make the delegation request specific enough for the user to approve or decline. In off mode, never invoke Agent. In auto mode, use Agent only for independent read-only exploration or review; otherwise work directly.
</execution_planning>`,
    project.content ? `<project_rules source="AGENTS.md">\n${project.content}\n</project_rules>` : '',
    `<task_contract>\nWork mode: ${task.config.workMode}. ${modeLabels[task.config.workMode]}\nGoal: ${task.config.taskGoal || 'Use the current user request as the task goal.'}\nAcceptance criteria: ${task.config.acceptanceCriteria || 'Confirm the requested outcome and report verification.'}\nFor a code review, audit, comparison, or recommendation report: give a concrete conclusion, evidence with file or scope references, prioritized recommendations, and a Markdown table for the key findings. Never claim that a table, appendix, or full report exists unless you include it in this same final answer. Do not inflate issue counts beyond findings you can support.\n</task_contract>`,
    task.config.systemPrompt ? `<advanced_agent_instruction>\n${task.config.systemPrompt}\n</advanced_agent_instruction>` : ''
  ]
  return sections.filter(Boolean).join('\n\n')
}

export function buildTurnPrompt(runtimeContext: string, userText: string): string {
  return [runtimeContext, `<user_request>\n${userText}\n</user_request>`].filter(Boolean).join('\n\n')
}
