import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, Plus, Save, Server, Trash2, Wifi } from 'lucide-react'
import type { ProviderInput, ProviderKind, ProviderProfile, ProviderTestResult } from '../../../../shared/types'
import { useAppStore } from '../../store'

function inputFrom(provider: ProviderProfile): ProviderInput {
  return { id: provider.id, name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, mainModel: provider.mainModel, fastModel: provider.fastModel, capabilities: provider.capabilities, preserveSecret: true }
}

export function ProvidersPanel(): React.JSX.Element {
  const { providers, saveProvider, deleteProvider, sdkVersion } = useAppStore()
  const [selectedId, setSelectedId] = useState(providers[0]?.id ?? '')
  const selected = providers.find((item) => item.id === selectedId)
  const [form, setForm] = useState<ProviderInput | null>(selected ? inputFrom(selected) : null)
  const [apiKey, setApiKey] = useState('')
  const [headers, setHeaders] = useState('{}')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ProviderTestResult | null>(null)

  useEffect(() => { if (!selectedId && providers[0]) setSelectedId(providers[0].id) }, [providers, selectedId])
  useEffect(() => { if (selected) { setForm(inputFrom(selected)); setApiKey(''); setHeaders('{}'); setResult(null) } }, [selectedId, providers.length])
  if (!form) return <div className="panel-empty"><Server size={24} /><strong>没有 Provider</strong></div>
  const patch = (value: Partial<ProviderInput>): void => setForm({ ...form, ...value })
  const create = (): void => {
    const id = crypto.randomUUID(); setSelectedId(id); setForm({ id, name: '自定义 Provider', kind: 'compatible', baseUrl: 'https://', mainModel: '', fastModel: '', capabilities: { thinking: true, effort: true, images: false, structuredOutput: true, toolUse: true }, preserveSecret: false }); setApiKey(''); setHeaders('{}')
  }
  const save = async (): Promise<void> => { try { await saveProvider({ ...form, apiKey: apiKey || undefined, customHeaders: JSON.parse(headers), preserveSecret: !apiKey }); setApiKey('') } catch { /* Store error is displayed by the shared toast. */ } }
  const test = async (): Promise<void> => { setTesting(true); setResult(await window.agentDesk.testProvider(form.id)); setTesting(false) }

  return (
    <div className="providers-panel">
      <div className="provider-tabs">{providers.map((provider) => <button key={provider.id} className={provider.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(provider.id)}><i className={provider.hasApiKey ? 'ready' : ''} />{provider.name}</button>)}<button onClick={create}><Plus size={14} />新增</button></div>
      <div className="provider-form">
        <div className="provider-heading"><div className="provider-logo"><Server size={21} /></div><div><strong>{form.name}</strong><span>通过 Claude Agent SDK v{sdkVersion} 运行</span></div></div>
        <label className="field"><span>显示名称</span><input value={form.name} onChange={(e) => patch({ name: e.target.value })} /></label>
        <label className="field"><span>Provider 类型</span><select value={form.kind} onChange={(e) => patch({ kind: e.target.value as ProviderKind })}><option value="anthropic">Anthropic 官方</option><option value="deepseek">DeepSeek Anthropic 格式</option><option value="compatible">通用 Anthropic 兼容</option></select></label>
        <label className="field"><span>Base URL</span><input value={form.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} /><small>{form.kind === 'deepseek' && 'DeepSeek 官方端点应为 https://api.deepseek.com/anthropic'}</small></label>
        <div className="two-fields"><label className="field"><span>主模型</span><input value={form.mainModel} onChange={(e) => patch({ mainModel: e.target.value })} /></label><label className="field"><span>快速 / 子 Agent 模型</span><input value={form.fastModel} onChange={(e) => patch({ fastModel: e.target.value })} /><small>可留空；若与主模型相同，不会作为回退模型传给 SDK。</small></label></div>
        <label className="field"><span>API Key {selected?.hasApiKey && <i className="saved-key"><Check size={12} />已安全保存</i>}</span><div className="secret-input"><KeyRound size={15} /><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={selected?.hasApiKey ? '留空以保留现有密钥' : '输入 API Key'} /><button onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
        <label className="field"><span>自定义 Headers · JSON</span><textarea className="json-editor" rows={4} value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false} /><small>Header 值会和 API Key 一样加密保存，日志中不会显示。</small></label>
        <div className="capability-grid">{Object.entries(form.capabilities).map(([key, value]) => <label key={key} className={value ? 'checked' : ''}><input type="checkbox" checked={value} onChange={(e) => patch({ capabilities: { ...form.capabilities, [key]: e.target.checked } })} />{key}</label>)}</div>
        {result && <div className={`test-result ${result.ok ? 'ok' : 'failed'}`}><Wifi size={16} /><div><strong>{result.ok ? '连接成功' : '连接失败'} · {result.latencyMs}ms</strong><span>{result.message}</span></div></div>}
        <div className="provider-actions">{!['anthropic', 'deepseek'].includes(form.id) && <button className="danger" onClick={() => void deleteProvider(form.id)}><Trash2 size={15} />删除</button>}<span /><button className="secondary" disabled={!selected?.hasApiKey && !apiKey} onClick={() => void test()}>{testing ? <LoaderCircle size={15} className="spin" /> : <Wifi size={15} />}测试连接</button><button className="primary" onClick={() => void save()}><Save size={15} />保存</button></div>
      </div>
    </div>
  )
}
