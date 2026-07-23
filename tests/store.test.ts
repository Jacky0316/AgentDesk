import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

import { AppStore } from '../src/main/store.js'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('local JSON store', () => {
  it('persists an encrypted Provider secret, workspace, task, and ordered events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentdesk-store-')); directories.push(directory)
    const path = join(directory, 'agentdesk.json')
    const store = new AppStore(path)
    store.saveProvider({ id: 'local', name: 'Local compatible', kind: 'compatible', baseUrl: 'https://example.test/anthropic', mainModel: 'test-model', fastModel: '', apiKey: 'secret-value', customHeaders: { 'x-demo': 'yes' }, capabilities: { thinking: false, effort: false, images: false, structuredOutput: true, toolUse: true } })
    const workspace = store.upsertWorkspace('D:\\work\\demo', true)
    const task = store.createTask(workspace.id, '验证任务', { providerId: 'local', model: 'test-model' })
    store.appendEvent(task.id, 'sdk', { type: 'app_user', text: 'hello' })
    store.appendEvent(task.id, 'status', { status: 'idle' })

    expect(store.getProvider('local').hasApiKey).toBe(true)
    expect(store.getProviderSecret('local')).toEqual({ apiKey: 'secret-value', customHeaders: { 'x-demo': 'yes' } })
    expect(store.listEvents(task.id).map((item) => item.sequence)).toEqual([1, 2])
    expect(readFileSync(path, 'utf8')).not.toContain('secret-value')

    const reloaded = new AppStore(path)
    expect(reloaded.getTask(task.id)).toMatchObject({ title: '验证任务', workspacePath: 'D:\\work\\demo', providerId: 'local' })
    expect(reloaded.getProviderSecret('local').apiKey).toBe('secret-value')
  })

  it('creates a standalone task without a workspace or file tools', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentdesk-standalone-')); directories.push(directory)
    const store = new AppStore(join(directory, 'agentdesk.json'))
    const task = store.createStandaloneTask('普通任务')
    expect(task).toMatchObject({ scope: 'standalone', workspaceId: null, workspacePath: null, config: { tools: [] } })
    expect(new AppStore(join(directory, 'agentdesk.json')).getTask(task.id).scope).toBe('standalone')
  })

  it('removes a project without deleting its tasks, safely converting them to standalone', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentdesk-remove-project-')); directories.push(directory)
    const store = new AppStore(join(directory, 'agentdesk.json'))
    const project = store.upsertWorkspace('D:\work\removable', false)
    const task = store.createTask(project.id)
    store.appendEvent(task.id, 'sdk', { type: 'app_user', text: 'keep task history' })
    store.removeWorkspace(project.id)
    expect(store.listWorkspaces()).toHaveLength(0)
    expect(store.getTask(task.id)).toMatchObject({ scope: 'standalone', workspaceId: null, workspacePath: null, config: { tools: [] } })
    store.deleteTask(task.id)
    expect(store.listTasks()).toHaveLength(0)
    expect(store.listEvents(task.id)).toHaveLength(0)
  })
})
