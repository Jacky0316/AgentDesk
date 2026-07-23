import { FileCode2, GitBranch, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'
import { useAppStore } from '../../store'

export function DiffPanel(): React.JSX.Element {
  const { diff, refreshDiff, activeTaskId, permissions } = useAppStore()
  const pending = permissions.find((item) => item.taskId === activeTaskId)
  useEffect(() => { void refreshDiff() }, [activeTaskId, refreshDiff])
  return (
    <div className="diff-panel">
      {pending && <section className="approval-detail"><header><ShieldCheck size={15} /><strong>待授权操作详情</strong></header><p>{pending.description || 'Agent 请求执行需要确认的操作。'}</p><pre>{JSON.stringify(pending.input, null, 2)}</pre></section>}
      <div className="panel-toolbar"><span>{diff?.files.length ?? 0} 个文件</span><button onClick={() => void refreshDiff()}><RefreshCw size={14} />刷新</button></div>
      {!diff?.isGit && <div className="panel-empty"><GitBranch size={24} /><strong>未检测到 Git 仓库</strong><span>{diff?.error}</span></div>}
      {diff?.isGit && diff.files.length === 0 && <div className="panel-empty"><GitBranch size={24} /><strong>工作区没有更改</strong><span>Agent 的文件修改会显示在这里。</span></div>}
      {diff?.files.map((file) => <div className="diff-file" key={file.path}><FileCode2 size={15} /><span>{file.path}</span><i className="added">+{file.insertions}</i><i className="deleted">-{file.deletions}</i><b>{file.status}</b></div>)}
      {diff?.patch && <pre className="diff-patch">{diff.patch.split('\n').map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'line-add' : line.startsWith('-') && !line.startsWith('---') ? 'line-del' : line.startsWith('@@') ? 'line-hunk' : ''}>{line}{'\n'}</span>)}</pre>}
    </div>
  )
}
