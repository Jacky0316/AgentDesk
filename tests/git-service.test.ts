import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDiff, isGitWorkspace } from '../src/main/git-service.js'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function git(cwd: string, args: string[]): void { execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' }) }

describe('Git Diff service', () => {
  it('reports tracked modifications and untracked files from a real repository', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentdesk-git-')); directories.push(directory)
    git(directory, ['init'])
    git(directory, ['config', 'user.email', 'agentdesk@example.test'])
    git(directory, ['config', 'user.name', 'AgentDesk Test'])
    writeFileSync(join(directory, 'tracked.txt'), 'before\n', 'utf8')
    git(directory, ['add', 'tracked.txt']); git(directory, ['commit', '-m', 'initial'])
    writeFileSync(join(directory, 'tracked.txt'), 'after\n', 'utf8')
    writeFileSync(join(directory, 'new.txt'), 'new file\n', 'utf8')

    expect(await isGitWorkspace(directory)).toBe(true)
    const diff = await getDiff(directory)
    expect(diff.isGit).toBe(true)
    expect(diff.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tracked.txt', status: 'M', insertions: 1, deletions: 1 }),
      expect.objectContaining({ path: 'new.txt', status: '??' })
    ]))
    expect(diff.patch).toContain('-before')
    expect(diff.patch).toContain('+after')
  })

  it('returns a clear non-Git state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentdesk-nogit-')); directories.push(directory)
    await expect(getDiff(directory)).resolves.toMatchObject({ isGit: false, files: [] })
  })
})
