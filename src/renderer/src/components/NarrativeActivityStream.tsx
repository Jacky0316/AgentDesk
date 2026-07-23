import { Check, ChevronDown, CircleAlert, FilePenLine, FileSearch, LoaderCircle, Terminal, UsersRound } from 'lucide-react'
import type { OperationItem, VisibleActivityTurn } from '../../../shared/event-mapper'

function elapsed(startedAt: string, endedAt: string, running: boolean): string {
  const seconds = Math.max(0, Math.floor(((running ? Date.now() : new Date(endedAt).getTime()) - new Date(startedAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function OperationLine({ item }: { item: OperationItem }): React.JSX.Element {
  const failed = item.status === 'failed'
  const Icon = item.type === 'command' ? Terminal : item.type === 'delegation' ? UsersRound : item.action === 'read' || item.action === 'search' ? FileSearch : FilePenLine
  const copy = item.type === 'command'
    ? `运行 ${item.command}`
    : item.type === 'delegation'
      ? '已委派独立、只读的子任务'
      : `${item.action === 'read' ? '已读取' : item.action === 'search' ? '已检查' : item.action === 'edit' ? '已编辑' : '已写入'} ${item.path.split(/[\\/]/).at(-1) || item.path}`
  return <div className={`narrative-operation ${failed ? 'failed' : ''}`}><Icon size={14} /><span>{copy}</span>{failed ? <CircleAlert size={13} /> : <Check size={13} />}</div>
}

export function NarrativeActivityStream({ turn, running }: { turn: VisibleActivityTurn; running: boolean }): React.JSX.Element {
  const hasEvents = turn.events.length > 0
  return <section className="narrative-activity">
    <details className="turn-elapsed" open={running}><summary>{running ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}<span>{running ? '处理中' : '已处理'} {elapsed(turn.startedAt, turn.endedAt, running)}</span><ChevronDown size={14} /></summary><div>本轮执行记录已归纳；完整审计事件可在右侧查看。</div></details>
    {turn.events.map((event) => {
      if (event.type === 'narrative') return <p className={`narrative-paragraph ${event.phase}`} key={event.key}>{event.text}</p>
      if (event.type === 'error') return <div className="narrative-error" key={event.key}><CircleAlert size={15} /><span>{event.summary}</span></div>
      if (!event.items.length) return null
      return <details className="narrative-group" key={event.key}><summary><Terminal size={14} /><span>{event.label}</span><small>{event.items.length} 项</small><ChevronDown size={14} /></summary><div>{event.items.map((item) => <OperationLine item={item} key={item.key} />)}</div></details>
    })}
    {running && !hasEvents && <p className="narrative-paragraph intent">已确认任务目标，正在收集完成本轮所需的证据。</p>}
  </section>
}
