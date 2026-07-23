import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { useAppStore } from '../../store'

export function TerminalPanel(): React.JSX.Element {
  const activeTaskId = useAppStore((state) => state.activeTaskId)
  const setError = useAppStore((state) => state.setError)
  const host = useRef<HTMLDivElement>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeTaskId || !host.current) return
    const terminal = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 12, theme: { background: '#141414', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#3f3f46' } })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    fit.fit()
    let currentId: string | null = null
    const unsubscribe = window.agentDesk.onTerminalData((event) => { if (event.terminalId === currentId) terminal.write(event.data) })
    const dataDisposable = terminal.onData((data) => { if (currentId) void window.agentDesk.writeTerminal(currentId, data) })
    const observer = new ResizeObserver(() => { fit.fit(); if (currentId) void window.agentDesk.resizeTerminal(currentId, terminal.cols, terminal.rows) })
    observer.observe(host.current)
    void window.agentDesk.createTerminal(activeTaskId).then((id) => { currentId = id; setTerminalId(id); fit.fit(); return window.agentDesk.resizeTerminal(id, terminal.cols, terminal.rows) }).catch((error) => setError(error instanceof Error ? error.message : String(error)))
    return () => {
      observer.disconnect(); unsubscribe(); dataDisposable.dispose(); terminal.dispose()
      if (currentId) void window.agentDesk.closeTerminal(currentId)
    }
  }, [activeTaskId, setError])

  return <div className="terminal-panel"><div className="terminal-toolbar"><span>PowerShell · {terminalId ? '已连接' : '启动中'}</span>{!terminalId && <LoaderCircle size={14} className="spin" />}<button title="终端与任务工作区相同"><RotateCcw size={14} /></button></div><div className="terminal-host" ref={host} /></div>
}
