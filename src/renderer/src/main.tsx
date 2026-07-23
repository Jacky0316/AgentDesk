import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './codex-light.css'
import './ui/shell.css'
import './ui/sidebar.css'
import './ui/canvas.css'
import './ui/composer.css'
import './ui/observer.css'
import './ui/fixes.css'
import './ui/dark-theme.css'
import './ui/layout-fixes.css'
import './ui/conversation.css'
import './ui/execution-status.css'
import './styles/execution-plan.css'
import './ui/provider-tools.css'
import './ui/reader.css'

const rootElement = document.getElementById('root')

function showFatal(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (rootElement) rootElement.innerHTML = `<main style="height:100vh;display:grid;place-items:center;padding:32px;background:#1d1d1c;color:#f1c2bc;font:14px Segoe UI,sans-serif"><section style="max-width:760px;border:1px solid #7a4741;border-radius:10px;padding:20px;background:#30201f"><h1 style="margin-top:0;font-size:18px">AgentDesk Renderer 启动失败</h1><pre style="white-space:pre-wrap;margin:0;color:#e7b1aa">${message.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))}</pre></section></main>`
}

window.addEventListener('error', (event) => showFatal(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => showFatal(event.reason))

if (!rootElement) throw new Error('Renderer root element #root was not found.')

void import('./App')
  .then(({ App }) => ReactDOM.createRoot(rootElement).render(<React.StrictMode><App /></React.StrictMode>))
  .catch(showFatal)
