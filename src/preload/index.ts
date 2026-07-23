import { contextBridge, ipcRenderer } from 'electron'
import type { AgentDeskApi, RuntimeEvent, TerminalChunk } from '../shared/types.js'

const api: AgentDeskApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  removeWorkspace: (workspaceId) => ipcRenderer.invoke('workspace:remove', workspaceId),
  createTask: (input) => ipcRenderer.invoke('task:create', input),
  createStandaloneTask: (input) => ipcRenderer.invoke('task:create-standalone', input),
  updateTask: (taskId, patch) => ipcRenderer.invoke('task:update', taskId, patch),
  deleteTask: (taskId) => ipcRenderer.invoke('task:delete', taskId),
  loadEvents: (taskId) => ipcRenderer.invoke('task:events', taskId),
  sendMessage: (taskId, input) => ipcRenderer.invoke('task:send', taskId, input),
  stopTask: (taskId) => ipcRenderer.invoke('task:stop', taskId),
  setPermissionMode: (taskId, mode) => ipcRenderer.invoke('task:permission-mode', taskId, mode),
  setModel: (taskId, input) => ipcRenderer.invoke('task:model', taskId, input),
  resolvePermission: (input) => ipcRenderer.invoke('permission:resolve', input),
  listProviders: () => ipcRenderer.invoke('provider:list'),
  saveProvider: (input) => ipcRenderer.invoke('provider:save', input),
  deleteProvider: (id) => ipcRenderer.invoke('provider:delete', id),
  testProvider: (id) => ipcRenderer.invoke('provider:test', id),
  getDiff: (taskId) => ipcRenderer.invoke('git:diff', taskId),
  listWorkspaceFiles: (taskId) => ipcRenderer.invoke('workspace:files', taskId),
  readWorkspaceFile: (taskId, path) => ipcRenderer.invoke('workspace:file-preview', taskId, path),
  openFiles: () => ipcRenderer.invoke('files:open'),
  createTerminal: (taskId) => ipcRenderer.invoke('terminal:create', taskId),
  writeTerminal: (terminalId, data) => ipcRenderer.invoke('terminal:write', terminalId, data),
  resizeTerminal: (terminalId, cols, rows) => ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
  closeTerminal: (terminalId) => ipcRenderer.invoke('terminal:close', terminalId),
  onRuntimeEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: RuntimeEvent): void => listener(value)
    ipcRenderer.on('runtime:event', handler)
    return () => ipcRenderer.removeListener('runtime:event', handler)
  },
  onTerminalData: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: TerminalChunk): void => listener(value)
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },
  onMenuCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: 'new-task' | 'toggle-sidebar' | 'toggle-observer' | 'learn-more'): void => listener(command)
    ipcRenderer.on('menu:command', handler)
    return () => ipcRenderer.removeListener('menu:command', handler)
  }
}

contextBridge.exposeInMainWorld('agentDesk', api)
