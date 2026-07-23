import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { z } from 'zod'
import { AgentRuntime } from './agent-runtime.js'
import { getDiff, isGitWorkspace } from './git-service.js'
import { AppStore } from './store.js'
import { TerminalManager } from './terminal-manager.js'
import type { PermissionMode, ProviderInput, RuntimeEvent, TaskConfig } from '../shared/types.js'
import { parseProviderInput } from '../shared/config.js'
import { listWorkspaceFiles, previewWorkspaceFile } from './workspace-files.js'

let mainWindow: BrowserWindow | null = null
let store: AppStore
let runtime: AgentRuntime
let terminals: TerminalManager

function sendMenuCommand(command: 'new-task' | 'toggle-sidebar' | 'toggle-observer' | 'learn-more'): void {
  mainWindow?.webContents.send('menu:command', command)
}

function createMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '新建任务', accelerator: 'Ctrl+N', click: () => sendMenuCommand('new-task') }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }] },
    { label: '视图', submenu: [{ label: '显示/隐藏侧栏', click: () => sendMenuCommand('toggle-sidebar') }, { label: '显示/隐藏观察器', click: () => sendMenuCommand('toggle-observer') }, { type: 'separator' }, { role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }] },
    { label: '帮助', submenu: [{ label: '学习版说明', click: () => sendMenuCommand('learn-more') }] }
  ]))
}

const idSchema = z.string().min(1).max(200)
const imageAttachmentSchema = z.object({ path: z.string().min(1).max(500), name: z.string().min(1).max(240) })
const messageInputSchema = z.object({ text: z.string().max(200_000), images: z.array(imageAttachmentSchema).max(5).optional() }).refine((value) => Boolean(value.text.trim()) || Boolean(value.images?.length), { message: '请输入任务描述或添加图片。' })
const permissionModes = z.enum(['default', 'acceptEdits', 'dontAsk', 'plan', 'bypassPermissions', 'auto'])

function sendRuntimeEvent(event: RuntimeEvent): void {
  if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('runtime:event', event)
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', () => ({
    providers: store.listProviders(),
    workspaces: store.listWorkspaces(),
    tasks: store.listTasks(),
    sdkVersion: '0.3.214',
    platform: process.platform
  }))

  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择 Agent 工作区' })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return store.upsertWorkspace(path, await isGitWorkspace(path))
  })
  ipcMain.handle('workspace:remove', (_event, workspaceId: string) => store.removeWorkspace(idSchema.parse(workspaceId)))

  ipcMain.handle('task:create', (_event, input: { workspaceId: string; title?: string; config?: Partial<TaskConfig> }) => {
    idSchema.parse(input.workspaceId)
    return store.createTask(input.workspaceId, input.title?.slice(0, 160), input.config)
  })
  ipcMain.handle('task:create-standalone', (_event, input?: { title?: string; config?: Partial<TaskConfig> }) => store.createStandaloneTask(input?.title?.slice(0, 160), input?.config))

  ipcMain.handle('task:update', (_event, taskId: string, patch: { title?: string; config?: Partial<TaskConfig>; archived?: boolean }) => {
    idSchema.parse(taskId)
    return store.updateTask(taskId, {
      title: patch.title?.slice(0, 160),
      config: patch.config,
      status: patch.archived ? 'archived' : undefined
    })
  })
  ipcMain.handle('task:delete', (_event, taskId: string) => store.deleteTask(idSchema.parse(taskId)))

  ipcMain.handle('task:events', (_event, taskId: string) => store.listEvents(idSchema.parse(taskId)))
  ipcMain.handle('task:send', async (_event, taskId: string, input: unknown) => {
    const parsed = messageInputSchema.parse(input)
    return runtime.send(idSchema.parse(taskId), parsed.text, parsed.images ?? [])
  })
  ipcMain.handle('task:stop', async (_event, taskId: string) => runtime.interrupt(idSchema.parse(taskId)))
  ipcMain.handle('task:permission-mode', async (_event, taskId: string, mode: PermissionMode) => runtime.setPermissionMode(idSchema.parse(taskId), permissionModes.parse(mode)))
  ipcMain.handle('task:model', async (_event, taskId: string, input: { providerId: string; model: string }) => runtime.setModel(idSchema.parse(taskId), { providerId: idSchema.parse(input.providerId), model: z.string().min(1).max(200).parse(input.model) }))
  ipcMain.handle('permission:resolve', (_event, input: { requestId: string; behavior: 'allow' | 'deny'; message?: string }) => {
    runtime.resolvePermission(idSchema.parse(input.requestId), z.enum(['allow', 'deny']).parse(input.behavior), input.message)
  })

  ipcMain.handle('provider:list', () => store.listProviders())
  ipcMain.handle('provider:save', (_event, input: ProviderInput) => store.saveProvider(parseProviderInput(input)))
  ipcMain.handle('provider:delete', (_event, id: string) => store.deleteProvider(idSchema.parse(id)))
  ipcMain.handle('provider:test', (_event, id: string) => runtime.testProvider(idSchema.parse(id)))

  ipcMain.handle('git:diff', async (_event, taskId: string) => {
    const workspacePath = store.getTask(idSchema.parse(taskId)).workspacePath
    if (!workspacePath) throw new Error('普通任务没有项目差异。')
    return getDiff(workspacePath)
  })
  ipcMain.handle('workspace:files', (_event, taskId: string) => {
    const workspacePath = store.getTask(idSchema.parse(taskId)).workspacePath
    if (!workspacePath) throw new Error('普通任务没有可浏览的项目目录。')
    return listWorkspaceFiles(workspacePath)
  })
  ipcMain.handle('workspace:file-preview', (_event, taskId: string, filePath: string) => {
    const workspacePath = store.getTask(idSchema.parse(taskId)).workspacePath
    if (!workspacePath) throw new Error('普通任务没有可浏览的项目目录。')
    return previewWorkspaceFile(workspacePath, z.string().min(1).max(500).parse(filePath))
  })
  ipcMain.handle('files:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'], title: '添加文件到对话' })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('terminal:create', (_event, taskId: string) => {
    const workspacePath = store.getTask(idSchema.parse(taskId)).workspacePath
    if (!workspacePath) throw new Error('普通任务不提供终端。')
    return terminals.create(workspacePath)
  })
  ipcMain.handle('terminal:write', (_event, id: string, data: string) => terminals.write(idSchema.parse(id), z.string().max(100_000).parse(data)))
  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => terminals.resize(idSchema.parse(id), cols, rows))
  ipcMain.handle('terminal:close', (_event, id: string) => terminals.close(idSchema.parse(id)))
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#101722',
    title: 'AgentDesk',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101722', symbolColor: '#b7c8da', height: 32 },
    webPreferences: {
      // electron-vite emits the preload bundle as ESM (`index.mjs`).
      // A `.js` path silently leaves the Renderer without window.agentDesk.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The ESM preload emitted by electron-vite requires the regular preload
      // context. Context isolation and disabled Node integration remain the
      // security boundary for this local desktop application.
      sandbox: false,
      webSecurity: true
    }
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription} · ${validatedURL}`)
    if (!mainWindow?.isDestroyed()) mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.agentdesk.app')
  store = new AppStore(join(app.getPath('userData'), 'agentdesk.db'))
  const unpackedClaude = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe')
  runtime = new AgentRuntime(store, sendRuntimeEvent, 3, join(app.getPath('userData'), 'standalone-workspace'), app.isPackaged && existsSync(unpackedClaude) ? unpackedClaude : undefined)
  terminals = new TerminalManager((terminalId, data) => mainWindow?.webContents.send('terminal:data', { terminalId, data }))
  registerIpc()
  createMenu()
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  runtime?.closeAll()
  terminals?.closeAll()
  store?.close()
})
