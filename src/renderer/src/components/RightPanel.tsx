import { Braces, ClipboardList, Files, FolderOpen, Settings2 } from 'lucide-react'
import { useAppStore } from '../store'
import { LabPanel } from './panels/LabPanel'
import { ProvidersPanel } from './panels/ProvidersPanel'
import { RunPanel } from './panels/RunPanel'
import { DiffPanel } from './panels/DiffPanel'
import { ProjectFilesPanel } from './panels/ProjectFilesPanel'

export function RightPanel(): React.JSX.Element {
  const { rightPanel: panel, setRightPanel } = useAppStore()
  const meta = panel === 'lab' ? { label: 'SDK 实验室', Icon: Braces } : panel === 'providers' ? { label: '模型设置', Icon: Settings2 } : { label: '项目检查器', Icon: ClipboardList }
  const tabs = [{ id: 'run' as const, label: '运行记录', Icon: ClipboardList }, { id: 'files' as const, label: '项目文件', Icon: FolderOpen }, { id: 'changes' as const, label: '变更', Icon: Files }]
  return <aside className="right-panel"><header><div><meta.Icon size={17} /><strong>{meta.label}</strong></div></header>{panel !== 'lab' && panel !== 'providers' && <nav className="inspector-tabs">{tabs.map(({ id, label, Icon }) => <button key={id} className={panel === id ? 'active' : ''} onClick={() => setRightPanel(id)}><Icon size={14} />{label}</button>)}</nav>}<div className="panel-content">{panel === 'lab' ? <LabPanel /> : panel === 'providers' ? <ProvidersPanel /> : panel === 'files' ? <ProjectFilesPanel /> : panel === 'changes' ? <DiffPanel /> : <RunPanel />}</div></aside>
}
