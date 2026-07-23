import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceFileNode, WorkspaceFilePreview } from '../../../../shared/types'
import { useAppStore } from '../../store'

function TreeNode({ node, depth, query, onOpen }: { node: WorkspaceFileNode; depth: number; query: string; onOpen: (path: string) => void }): React.JSX.Element | null {
  const [open, setOpen] = useState(depth < 1)
  const matches = !query || node.name.toLowerCase().includes(query.toLowerCase()) || node.children?.some((child) => child.name.toLowerCase().includes(query.toLowerCase()))
  if (!matches) return null
  if (node.kind === 'file') return <button className="project-file-row" style={{ paddingLeft: 12 + depth * 15 }} onClick={() => onOpen(node.path)}><FileCode2 size={14} /><span>{node.name}</span></button>
  return <div><button className="project-file-row folder" style={{ paddingLeft: 12 + depth * 15 }} onClick={() => setOpen((value) => !value)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{open ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{node.name}</span></button>{open && node.children?.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} query={query} onOpen={onOpen} />)}</div>
}

export function ProjectFilesPanel(): React.JSX.Element {
  const { activeTaskId, tasks } = useAppStore()
  const [nodes, setNodes] = useState<WorkspaceFileNode[]>([])
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const task = tasks.find((item) => item.id === activeTaskId)
  const load = async (): Promise<void> => {
    if (!activeTaskId || !task?.workspacePath) { setNodes([]); setPreview(null); return }
    try { setError(''); setNodes(await window.agentDesk.listWorkspaceFiles(activeTaskId)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  useEffect(() => { void load() }, [activeTaskId, task?.workspacePath])
  const openFile = async (path: string): Promise<void> => {
    if (!activeTaskId) return
    try { setError(''); setPreview(await window.agentDesk.readWorkspaceFile(activeTaskId, path)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const visibleCount = useMemo(() => nodes.length, [nodes])
  if (!task?.workspacePath) return <div className="panel-empty"><Folder size={25} /><strong>当前是普通任务</strong><span>选择项目任务后可浏览其工作区文件。</span></div>
  return <div className="project-files-panel"><div className="project-files-toolbar"><label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件" /></label><button title="刷新文件目录" onClick={() => void load()}><RefreshCw size={14} /></button></div><div className="project-file-tree"><div className="project-file-root"><FolderOpen size={15} /><span>{task.workspacePath.split(/[\\/]/).at(-1)}</span><small>{visibleCount} 项</small></div>{nodes.map((node) => <TreeNode key={node.path} node={node} depth={0} query={query} onOpen={openFile} />)}</div>{error && <div className="project-file-error">{error}</div>}{preview && <section className="project-preview"><header><span>{preview.path}</span><button onClick={() => setPreview(null)}>关闭</button></header>{preview.truncated && <small>文件较大，仅显示前 96 KB。</small>}<pre>{preview.content}</pre></section>}</div>
}
