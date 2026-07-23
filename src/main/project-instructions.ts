import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface ProjectInstructions {
  source: string | null
  content: string
}

const MAX_PROJECT_INSTRUCTION_CHARS = 6_000

/**
 * Loads the repository-owned Agent guidance. Deliberately starts with the
 * workspace root only: it is predictable, reviewable, and never reads a
 * user's home-directory instructions into a project session.
 */
export function loadProjectInstructions(workspacePath: string | null): ProjectInstructions {
  if (!workspacePath) return { source: null, content: '' }
  const root = resolve(workspacePath)
  const source = join(root, 'AGENTS.md')
  if (!existsSync(source)) return { source: null, content: '' }
  try {
    if (relative(root, source).startsWith('..')) return { source: null, content: '' }
    return { source, content: readFileSync(source, 'utf8').trim().slice(0, MAX_PROJECT_INSTRUCTION_CHARS) }
  } catch {
    return { source: null, content: '' }
  }
}
