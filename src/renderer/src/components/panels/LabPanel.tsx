import { useEffect, useMemo, useState } from 'react'
import { Activity, Bot, Boxes, Braces, Check, ChevronDown, FlaskConical, RotateCcw, Save, ShieldCheck, Wrench } from 'lucide-react'
import type { TaskConfig } from '../../../../shared/types'
import { useAppStore } from '../../store'

const toolOptions = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'Agent', 'AskUserQuestion', 'WebFetch', 'WebSearch']
const webTools = new Set(['WebFetch', 'WebSearch'])

function jsonText(value: unknown): string { return JSON.stringify(value, null, 2) }

export function LabPanel(): React.JSX.Element {
  const { tasks, activeTaskId, events, updateTask, setError, sdkVersion, providers } = useAppStore()
  const task = tasks.find((item) => item.id === activeTaskId)
  const [draft, setDraft] = useState<TaskConfig | null>(task?.config ?? null)
  const [mcpText, setMcpText] = useState(jsonText(task?.config.mcpServers ?? {}))
  const [agentsText, setAgentsText] = useState(jsonText(task?.config.agents ?? {}))
  const [schemaText, setSchemaText] = useState(jsonText(task?.config.outputSchema ?? null))
  const [saved, setSaved] = useState(false)
  const rawEvents = useMemo(() => (task ? events[task.id] ?? [] : []).slice(-80).reverse(), [events, task])

  useEffect(() => {
    setDraft(task?.config ?? null)
    setMcpText(jsonText(task?.config.mcpServers ?? {})); setAgentsText(jsonText(task?.config.agents ?? {})); setSchemaText(jsonText(task?.config.outputSchema ?? null))
  }, [task?.id])
  if (!task || !draft) return <div className="panel-empty"><FlaskConical size={24} /><strong>先选择一个任务</strong><span>实验参数按任务保存。</span></div>

  const selectedProvider = providers.find((provider) => provider.id === task.config.providerId)
  const supportsWebTools = selectedProvider?.kind === 'anthropic'
  const isMiniMax = /minimax/i.test(`${selectedProvider?.id ?? ''} ${selectedProvider?.name ?? ''} ${selectedProvider?.baseUrl ?? ''}`)
  const miniMaxMcpHost = /(?:^|\.)minimaxi\.com(?:\/|$)/i.test(selectedProvider?.baseUrl ?? '') ? 'https://api.minimaxi.com' : 'https://api.minimax.io'
  const patch = <K extends keyof TaskConfig>(key: K, value: TaskConfig[K]): void => setDraft({ ...draft, [key]: value })
  const save = async (): Promise<void> => {
    try {
      const config = { ...draft, mcpServers: JSON.parse(mcpText), agents: JSON.parse(agentsText), outputSchema: JSON.parse(schemaText) } as TaskConfig
      await updateTask({ config }); setDraft(config); setSaved(true); setTimeout(() => setSaved(false), 1800)
    } catch (error) { setError(`JSON 配置无效：${error instanceof Error ? error.message : String(error)}`) }
  }
  const enableMiniMaxWebSearch = async (): Promise<void> => {
    try {
      if (!isMiniMax) throw new Error('请先在输入框右下角选择 MiniMax Provider。')
      const servers = JSON.parse(mcpText) as TaskConfig['mcpServers']
      const mcpServers = {
        ...servers,
        minimax_web_search: {
          command: 'uvx',
          args: ['minimax-coding-plan-mcp', '-y'],
          env: { ...servers.minimax_web_search?.env, MINIMAX_API_HOST: miniMaxMcpHost }
        }
      }
      const config = { ...draft, mcpServers }
      await updateTask({ config })
      setDraft(config); setMcpText(jsonText(mcpServers)); setSaved(true); setTimeout(() => setSaved(false), 1800)
    } catch (error) { setError(`无法启用 MiniMax 联网搜索：${error instanceof Error ? error.message : String(error)}`) }
  }

  return (
    <div className="lab-panel">
      <section className="lab-section task-contract-editor"><h3><Bot size={16} /><span>任务契约</span></h3><div className="lab-section-body">
        <Field label="任务目标"><textarea rows={3} value={draft.taskGoal} onChange={(e) => patch('taskGoal', e.target.value)} placeholder="说明本任务要达成的结果" /></Field>
        <Field label="验收标准"><textarea rows={3} value={draft.acceptanceCriteria} onChange={(e) => patch('acceptanceCriteria', e.target.value)} placeholder="说明如何判断任务完成" /></Field>
        <Field label="工作模式"><select value={draft.workMode} onChange={(e) => patch('workMode', e.target.value as TaskConfig['workMode'])}><option value="explore">探索：先理解并说明</option><option value="build">构建：实施并验证</option><option value="review">审查：只读检查与报告</option><option value="fix">修复：最小改动后验证</option></select></Field>
      </div></section>
      <div className="lab-banner"><FlaskConical size={20} /><div><strong>真实 SDK 运行参数</strong><span>修改后对新会话生效；模型与权限模式可在对话中实时切换。</span></div><b>v{sdkVersion}</b></div>

      <LabSection icon={<Bot size={16} />} title="模型与推理">
        <Field label="模型 ID"><input value={draft.model} onChange={(e) => patch('model', e.target.value)} /></Field>
        <div className="two-fields"><Field label="Effort"><select value={draft.effort} onChange={(e) => patch('effort', e.target.value as TaskConfig['effort'])}><option>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select></Field><Field label="Thinking"><select value={draft.thinking} onChange={(e) => patch('thinking', e.target.value as TaskConfig['thinking'])}><option value="adaptive">adaptive</option><option value="disabled">disabled</option></select></Field></div>
        <div className="two-fields"><Field label="最大轮数"><input type="number" min="1" max="500" value={draft.maxTurns} onChange={(e) => patch('maxTurns', Number(e.target.value))} /></Field><Field label="预算上限 USD"><input type="number" min="0.01" step="0.5" value={draft.maxBudgetUsd} onChange={(e) => patch('maxBudgetUsd', Number(e.target.value))} /></Field></div>
        <Field label="附加 System Prompt"><textarea rows={5} value={draft.systemPrompt} onChange={(e) => patch('systemPrompt', e.target.value)} placeholder="追加到 claude_code preset…" /></Field>
      </LabSection>

      <LabSection icon={<Boxes size={16} />} title="委派与预算">
        <div className="two-fields"><Field label="最大并发子 Agent"><input type="number" min="1" max="4" value={draft.maxConcurrentSubagents} onChange={(e) => patch('maxConcurrentSubagents', Math.max(1, Math.min(4, Number(e.target.value) || 1)))} /></Field><Field label="本轮最多委派"><input type="number" min="1" max="6" value={draft.maxDelegatedSubagentsPerTurn} onChange={(e) => patch('maxDelegatedSubagentsPerTurn', Math.max(1, Math.min(6, Number(e.target.value) || 1)))} /></Field></div>
        <small>普通任务默认预算为 $10；检测到明确的并行委派时，本轮预算会自动提升至 $30。达到 80% 会提示，达到上限可授权追加 $20 并从原会话继续。</small>
      </LabSection>
      <LabSection icon={<Wrench size={16} />} title="内置工具">
        <div className="tool-grid">{toolOptions.map((tool) => { const unavailable = webTools.has(tool) && !supportsWebTools; return <label key={tool} className={`${draft.tools.includes(tool) && !unavailable ? 'checked' : ''} ${unavailable ? 'disabled' : ''}`} title={unavailable ? 'WebSearch / WebFetch 仅在 Anthropic Claude Provider 下可用' : undefined}><input type="checkbox" disabled={unavailable} checked={draft.tools.includes(tool) && !unavailable} onChange={(e) => patch('tools', e.target.checked ? [...draft.tools, tool] : draft.tools.filter((item) => item !== tool))} /><span>{tool}{unavailable ? ' · Anthropic only' : ''}</span></label> })}</div>
      </LabSection>

      <LabSection icon={<Activity size={16} />} title="事件与检查点">
        <Toggle label="增量消息流" hint="includePartialMessages" checked={draft.includePartialMessages} onChange={(value) => patch('includePartialMessages', value)} />
        <Toggle label="Hook 生命周期事件" hint="includeHookEvents" checked={draft.includeHookEvents} onChange={(value) => patch('includeHookEvents', value)} />
        <Toggle label="转发子 Agent 原文（仅调试）" hint="forwardSubagentText · 主对话始终隐藏子 Agent 原文" checked={draft.forwardSubagentText} onChange={(value) => patch('forwardSubagentText', value)} />
        <Toggle label="文件检查点" hint="enableFileCheckpointing" checked={draft.enableFileCheckpointing} onChange={(value) => patch('enableFileCheckpointing', value)} />
      </LabSection>

      <LabSection icon={<Boxes size={16} />} title="MCP Servers">
        {isMiniMax && <div className="mcp-preset"><div><strong>MiniMax 联网搜索</strong><span>使用官方 `minimax-coding-plan-mcp`；密钥仅在运行时从已保存的 Provider 注入。</span></div><button className="secondary" onClick={() => void enableMiniMaxWebSearch()}>启用联网搜索</button></div>}
        <JsonEditor value={mcpText} onChange={setMcpText} placeholder={'{"server": {"command": "node", "args": ["server.js"]}}'} />
      </LabSection>
      <LabSection icon={<Bot size={16} />} title="子 Agent 定义"><JsonEditor value={agentsText} onChange={setAgentsText} placeholder={'{"reviewer": {"description": "...", "prompt": "...", "tools": ["Read"]}}'} /></LabSection>
      <LabSection icon={<Braces size={16} />} title="结构化输出 JSON Schema"><JsonEditor value={schemaText} onChange={setSchemaText} placeholder="null" /></LabSection>

      <LabSection icon={<Activity size={16} />} title={`原始事件 · 最近 ${rawEvents.length} 条`}>
        <div className="event-log">{rawEvents.map((event) => <details key={`${event.id}-${event.sequence}`}><summary><i className={`event-dot ${event.kind}`} />#{event.sequence} {event.kind} · {(event.payload as any)?.type ?? (event.payload as any)?.status ?? ''}</summary><pre>{jsonText(event.payload)}</pre></details>)}</div>
      </LabSection>

      <div className="sticky-save"><button className="secondary" onClick={() => setDraft(task.config)}><RotateCcw size={15} />重置</button><button className="primary" onClick={() => void save()}>{saved ? <Check size={15} /> : <Save size={15} />}{saved ? '已保存' : '保存实验配置'}</button></div>
    </div>
  )
}

function LabSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="lab-section"><h3>{icon}<span>{title}</span><ChevronDown size={14} /></h3><div className="lab-section-body">{children}</div></section>
}
function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element { return <label className="field"><span>{label}</span>{children}</label> }
function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }): React.JSX.Element { return <label className="toggle-row"><div><strong>{label}</strong><code>{hint}</code></div><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label> }
function JsonEditor({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }): React.JSX.Element { return <textarea className="json-editor" rows={7} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} /> }
