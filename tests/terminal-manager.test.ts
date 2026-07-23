import { describe, expect, it } from 'vitest'
import { TerminalManager } from '../src/main/terminal-manager.js'

describe('PowerShell terminal bridge', () => {
  it('creates a session, accepts input, and emits command output', async () => {
    const directory = process.cwd()
    const chunks: string[] = []
    const terminal = new TerminalManager((_id, data) => chunks.push(data))
    const id = terminal.create(directory)
    terminal.write(id, 'Write-Output "__agentdesk_terminal_ok__"\r\n')

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`terminal output timed out: ${chunks.join('')}`)), 8_000)
      const interval = setInterval(() => {
        if (chunks.join('').includes('__agentdesk_terminal_ok__')) { clearInterval(interval); clearTimeout(timer); resolve() }
      }, 30)
    })
    expect(chunks.join('')).toContain(`AgentDesk terminal · ${directory}`)
    terminal.close(id)
  }, 10_000)
})
