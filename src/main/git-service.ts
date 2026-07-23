import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DiffFile, DiffSnapshot } from '../shared/types.js'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true })
  return stdout
}

export async function isGitWorkspace(cwd: string): Promise<boolean> {
  try { return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true' }
  catch { return false }
}

export async function getDiff(cwd: string): Promise<DiffSnapshot> {
  if (!await isGitWorkspace(cwd)) return { isGit: false, files: [], patch: '', error: '当前文件夹不是 Git 仓库。' }
  try {
    const [statusText, unstaged, staged, numstat, stagedNumstat] = await Promise.all([
      git(cwd, ['status', '--porcelain=v1']),
      git(cwd, ['diff', '--no-ext-diff', '--no-color', '--']),
      git(cwd, ['diff', '--cached', '--no-ext-diff', '--no-color', '--']),
      git(cwd, ['diff', '--numstat', '--']),
      git(cwd, ['diff', '--cached', '--numstat', '--'])
    ])
    const stats = new Map<string, { insertions: number; deletions: number }>()
    for (const line of `${numstat}\n${stagedNumstat}`.split(/\r?\n/)) {
      const [added, deleted, path] = line.split('\t')
      if (!path) continue
      const current = stats.get(path) ?? { insertions: 0, deletions: 0 }
      current.insertions += Number.isFinite(Number(added)) ? Number(added) : 0
      current.deletions += Number.isFinite(Number(deleted)) ? Number(deleted) : 0
      stats.set(path, current)
    }
    const files: DiffFile[] = statusText.split(/\r?\n/).filter(Boolean).map((line) => {
      const status = line.slice(0, 2).trim() || 'M'
      const path = line.slice(3).replace(/^"|"$/g, '')
      const stat = stats.get(path) ?? { insertions: 0, deletions: 0 }
      return { path, status, ...stat }
    })
    const patch = [staged && '# Staged changes\n' + staged, unstaged && '# Working tree changes\n' + unstaged].filter(Boolean).join('\n')
    return { isGit: true, files, patch }
  } catch (error) {
    return { isGit: true, files: [], patch: '', error: error instanceof Error ? error.message : String(error) }
  }
}
