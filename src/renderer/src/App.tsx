import { useEffect } from 'react'
import { AlertCircle, Braces, PanelRightClose, PanelRightOpen, Settings2, X } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { RightPanel } from './components/RightPanel'
import { LabPanel } from './components/panels/LabPanel'
import { ProvidersPanel } from './components/panels/ProvidersPanel'
import { useAppStore } from './store'

export function App(): React.JSX.Element {
  const { bootstrap, loading, error, setError, rightPanel, appDrawer, setAppDrawer, sidebarVisible, setSidebarVisible, createStandaloneTask, setRightPanel } = useAppStore()
  const bridgeAvailable = Boolean(window.agentDesk)
  useEffect(() => {
    if (!bridgeAvailable) { setError('桌面桥接未加载。请关闭应用后重新启动最新版 AgentDesk。'); return }
    void bootstrap()
  }, [bootstrap, bridgeAvailable, setError])
  useEffect(() => {
    const unsubscribe = window.agentDesk?.onMenuCommand?.((command) => {
      if (command === 'new-task') void createStandaloneTask()
      if (command === 'toggle-sidebar') setSidebarVisible(!useAppStore.getState().sidebarVisible)
      if (command === 'toggle-observer') setRightPanel(useAppStore.getState().rightPanel === 'none' ? 'run' : 'none')
      if (command === 'learn-more') setError('学习版暂未开放该功能。')
    })

    // Never return a function crossing Electron's context bridge directly to
    // React. Some Electron versions proxy that value in a way React cannot
    // later call as an Effect cleanup (`destroy_ is not a function`).
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [createStandaloneTask, setError, setRightPanel, setSidebarVisible])

  if (!bridgeAvailable) return <div className="splash">桌面桥接未加载，请重新启动 AgentDesk。</div>

  if (loading) return <div className="splash"><div className="brand-mark">A</div><span>正在启动 Claude Agent SDK…</span></div>

  return (
    <div className="app-shell">
      <div className="title-drag-region" />
      {sidebarVisible && <Sidebar />}
      <main className="workspace-main"><ChatView /></main>
      {rightPanel !== 'none' && <RightPanel />}
      {appDrawer !== 'none' && <div className="app-drawer-backdrop" onMouseDown={() => setAppDrawer('none')}><section className="app-drawer" onMouseDown={(event) => event.stopPropagation()}><header><div>{appDrawer === 'lab' ? <Braces size={17} /> : <Settings2 size={17} />}<strong>{appDrawer === 'lab' ? 'SDK 实验室' : '模型设置'}</strong></div><button onClick={() => setAppDrawer('none')}><X size={17} /></button></header>{appDrawer === 'lab' ? <LabPanel /> : <ProvidersPanel />}</section></div>}
      {error && (
        <div className="toast error-toast">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  )
}

export const panelIcon = (open: boolean): React.JSX.Element => open ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />
