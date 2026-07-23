import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CheckCircle2, ChevronDown, CircleAlert, CircleDot, Clock3, PlayCircle, ShieldCheck, TerminalSquare, Wrench } from 'lucide-react'
import { buildRunTimeline, type RunTimelineItem } from '../../../../shared/event-mapper'
import { useAppStore } from '../../store'

type Filter = 'all' | 'tool' | 'approval' | 'error'

const icons = { user: CircleDot, thinking: Bot, tool: Wrench, 'tool-result': CheckCircle2, approval: ShieldCheck, 'approval-result': ShieldCheck, status: PlayCircle, stderr: TerminalSquare, error: CircleAlert, result: CheckCircle2 }

function elapsed(events: { createdAt: string }[]): string {
  if (events.length < 2) return '—'
  const ms = new Date(events.at(-1)!.createdAt).getTime() - new Date(events[0].createdAt).getTime()
  return ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`
}

export function RunPanel(): React.JSX.Element {
  const { activeTaskId, events, tasks } = useAppStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [raw, setRaw] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const taskEvents = activeTaskId ? events[activeTaskId] ?? [] : []
  const timeline = useMemo(() => buildRunTimeline(taskEvents), [taskEvents])
  const visible = timeline.filter((item) => filter === 'all' || filter === 'tool' && ['tool', 'tool-result'].includes(item.kind) || filter === 'approval' && item.kind.startsWith('approval') || filter === 'error' && ['error', 'stderr'].includes(item.kind))
  const task = tasks.find((item) => item.id === activeTaskId)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [visible.length])

  if (!task) return <div className="panel-empty run-empty"><Bot size={28} /><strong>Agent 运行记录会显示在这里</strong><span>创建或选择任务后，可查看本地保存的 SDK 事件流。</span></div>

  return <div className="run-panel">
    <div className="run-summary"><span className={`run-status ${task.status}`}>{task.status}</span><span><CircleDot size={13} /> {taskEvents.length} events</span><span><Clock3 size={13} /> {elapsed(taskEvents)}</span></div>
    <div className="run-filters"><div>{(['all', 'tool', 'approval', 'error'] as Filter[]).map((name) => <button className={filter === name ? 'active' : ''} key={name} onClick={() => setFilter(name)}>{({ all: '全部', tool: '工具', approval: '审批', error: '错误' })[name]}</button>)}</div><label><input type="checkbox" checked={raw} onChange={(event) => setRaw(event.target.checked)} /> 原始事件</label></div>
    <div className="run-timeline">
      {visible.length === 0 ? <div className="panel-empty"><span>此筛选下还没有记录。</span></div> : visible.map((item, index) => <Fragment key={item.key}>{item.kind === 'user' && index > 0 && <div className="timeline-turn-divider"><span>新一轮对话</span></div>}<TimelineRow item={item} raw={raw} /></Fragment>)}
      <div ref={end} />
    </div>
  </div>
}

function TimelineRow({ item, raw }: { item: RunTimelineItem; raw: boolean }): React.JSX.Element {
  const Icon = icons[item.kind]
  const time = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return <details className={`timeline-row ${item.tone}`}>
    <summary><span className="timeline-icon"><Icon size={14} /></span><span className="timeline-seq">#{item.sequence}</span><span className="timeline-copy"><strong>{item.title}</strong><em>{item.summary}</em></span><time>{time}</time><ChevronDown size={14} /></summary>
    <pre>{JSON.stringify(raw ? item.detail : { sequence: item.sequence, type: item.kind, summary: item.summary, detail: item.detail }, null, 2)}</pre>
  </details>
}
