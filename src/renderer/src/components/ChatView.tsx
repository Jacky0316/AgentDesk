import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleStop, FilePlus2, FolderOpen, LoaderCircle, Send, Shield, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PermissionPrompt } from '../../../shared/types'
import { buildChat, buildVisibleActivityTurns } from '../../../shared/event-mapper'
import { useAppStore } from '../store'
import { NarrativeActivityStream } from './NarrativeActivityStream'

type Attachment = { path: string; name: string; image: boolean }

function PermissionCard({ prompt }: { prompt: PermissionPrompt }): React.JSX.Element {
  const { resolvePermission: resolve, setRightPanel } = useAppStore()
  const delegation = prompt.toolName === 'Agent'
  const budget = prompt.toolName === 'BudgetContinuation'
  return <div className="permission-card"><Shield size={18} /><div><strong>{delegation ? '委派计划' : prompt.title}</strong><span>{delegation ? '主 Agent 请求委派独立、只读的子任务；最终结论由主 Agent 汇总。' : prompt.description}</span></div><button className="secondary detail" onClick={() => setRightPanel('changes')}>查看详情</button><button className="secondary" onClick={() => void resolve(prompt.requestId, 'deny')}>{budget ? '停止本轮' : delegation ? '主 Agent 直接处理' : '拒绝'}</button><button className="primary" onClick={() => void resolve(prompt.requestId, 'allow')}>{budget ? '提升预算并继续' : delegation ? '允许委派' : '允许一次'}</button></div>
}

function LiveStatus({ status, thinking, liveText }: { status: string; thinking: boolean; liveText: string }): React.JSX.Element | null {
  if (status !== 'running' && status !== 'waiting') return null
  const text = status === 'waiting' ? '等待你的确认' : thinking ? '正在分析' : liveText ? '正在生成回复' : '正在处理任务'
  return <div className="live-status"><LoaderCircle size={14} className={status === 'waiting' ? '' : 'spin'} />{text}</div>
}

const modeLabels = { default: '工作模式', plan: '规划模式', acceptEdits: '自动接受编辑', dontAsk: '拒绝未授权', bypassPermissions: '跳过审批', auto: '自动模式' } as const

export function ChatView(): React.JSX.Element {
  const state = useAppStore()
  const task = state.tasks.find((item) => item.id === state.activeTaskId)
  const taskEvents = task ? state.events[task.id] ?? [] : []
  const { items, liveText, liveThinking, thinking, budgetWarning } = useMemo(() => buildChat(taskEvents), [taskEvents])
  const turns = useMemo(() => buildVisibleActivityTurns(taskEvents), [taskEvents])
  const scroller = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: thinking ? 'auto' : 'smooth' }) }, [items.length, liveText, liveThinking, state.permissions.length, thinking])
  if (!task) return <div className="empty-chat"><div className="empty-brand"><div className="brand-icon">A</div><strong>AgentDesk</strong><p>创建一个任务后，开始与 Agent 协作。</p></div></div>

  const provider = state.providers.find((item) => item.id === task.config.providerId)
  const pending = state.permissions.filter((item) => item.taskId === task.id)
  const modelName = provider?.mainModel || task.config.model || '未选择模型'
  const selectableProviders = state.providers.filter((item) => item.hasApiKey && item.mainModel)
  const selectedModel = `${task.config.providerId}::${task.config.model}`
  const attach = async (): Promise<void> => { const paths = await window.agentDesk.openFiles(); const next = paths.map((path) => ({ path, name: path.split(/[\\/]/).at(-1) ?? path, image: /\.(png|jpe?g|gif|webp)$/i.test(path) })); if (next.some((item) => !item.image)) state.setError('当前附件仅支持直接发送 PNG、JPG、GIF 或 WebP 图片。'); setAttachments((current) => [...current, ...next.filter((item) => item.image && !current.some((existing) => existing.path === item.path))]) }
  const submit = (): void => { const images = attachments.filter((item) => item.image).map(({ path, name }) => ({ path, name })); if (!draft.trim() && !images.length) return; void state.send({ text: draft.trim(), images }); setDraft(''); setAttachments([]) }
  const delegationLabel = task.config.delegationMode === 'off' ? '不委派' : task.config.delegationMode === 'ask' ? '委派前确认' : '只读自动委派'

  return <div className="chat-layout"><header className="chat-header"><div className="task-heading"><strong>{task.title}</strong>{task.scope === 'project' && <span><FolderOpen size={13} />{state.workspaces.find((item) => item.id === task.workspaceId)?.name}</span>}</div></header><div className="conversation" ref={scroller}>{turns.length === 0 && <div className="conversation-intro"><div className="brand-icon hero">A</div><strong>AgentDesk</strong><h1>我们该使用 AgentDesk 做什么呢？</h1></div>}<div className="message-stack">{turns.map((turn, index) => {
    const current = index === turns.length - 1
    const showFinal = !current || task.status === 'idle' || task.status === 'error'
    return <section className="chat-turn" key={turn.key}><div className="user-message">{turn.user}</div><NarrativeActivityStream turn={turn} running={current && task.status === 'running'} />{current && budgetWarning && <div className="budget-warning">预算提示：已使用 ${budgetWarning.spentUsd.toFixed(2)} / ${budgetWarning.budgetUsd.toFixed(2)} USD</div>}{current && <LiveStatus status={task.status} thinking={thinking} liveText={liveText} />}{current && pending.map((prompt) => <PermissionCard prompt={prompt} key={prompt.requestId} />)}{showFinal && turn.final && <div className="assistant-message markdown final-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.final}</ReactMarkdown></div>}</section>
  })}</div></div><div className="composer-wrap"><div className="composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder="输入任务描述" rows={3} />{attachments.length > 0 && <div className="attachment-list">{attachments.map((attachment) => <button key={attachment.path} onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))}>图片 · {attachment.name}<X size={12} /></button>)}</div>}<div className="composer-toolbar"><div className="composer-left"><button className="icon-only" title="添加图片（PNG、JPG、GIF、WebP）" onClick={() => void attach()}><FilePlus2 size={17} /></button><label className="mode-select">{modeLabels[task.config.permissionMode]}<select value={task.config.permissionMode} onChange={(event) => void state.setPermissionMode(event.target.value as never)}><option value="default">工作模式</option><option value="plan">规划模式</option><option value="acceptEdits">自动接受编辑</option><option value="dontAsk">拒绝未授权</option></select></label><label className="mode-select">{delegationLabel}<select value={task.config.delegationMode} onChange={(event) => void state.updateTask({ config: { delegationMode: event.target.value as 'off' | 'ask' | 'auto' } })}><option value="off">不委派</option><option value="ask">委派前确认</option><option value="auto">只读自动委派</option></select></label></div><div className="composer-right"><label className="model-chip model-switcher" title={task.status === 'running' || task.status === 'waiting' ? '任务执行中，当前轮完成后才可切换模型' : `当前模型：${modelName}`}><select value={selectedModel} disabled={task.status === 'running' || task.status === 'waiting'} onChange={(event) => { const [providerId, model] = event.target.value.split('::'); if (providerId && model) void state.setModel({ providerId, model }) }}>{selectableProviders.map((item) => <option key={item.id} value={`${item.id}::${item.mainModel}`}>{item.name} / {item.mainModel}</option>)}</select></label>{task.status === 'running' ? <button className="send-button stop" onClick={() => void state.stop()}><CircleStop size={18} /></button> : <button className="send-button" disabled={!draft.trim() && !attachments.length} onClick={submit}><Send size={17} /></button>}</div></div></div></div></div>
}
