import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Lightweight PowerShell bridge for local SDK experiments; no native PTY build required. */
export class TerminalManager {
  private readonly terminals = new Map<string, ChildProcessWithoutNullStreams>()
  constructor(private readonly onData: (terminalId: string, data: string) => void) {}
  create(cwd: string): string {
    const id = randomUUID()
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
    const args = process.platform === 'win32' ? ['-NoLogo', '-NoExit', '-Command', '-'] : []
    const child = spawn(shell, args, { cwd, windowsHide: true })
    child.stdout.on('data', (chunk: Buffer) => this.onData(id, chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => this.onData(id, chunk.toString()))
    child.on('close', () => this.terminals.delete(id))
    this.terminals.set(id, child); this.onData(id, `\r\nAgentDesk terminal · ${cwd}\r\n`); return id
  }
  write(id: string, data: string): void { const child = this.terminals.get(id); if (!child) throw new Error('终端会话不存在。'); child.stdin.write(data) }
  resize(_id: string, _cols: number, _rows: number): void { /* Pipes do not expose terminal geometry. */ }
  close(id: string): void { this.terminals.get(id)?.kill(); this.terminals.delete(id) }
  closeAll(): void { for (const terminal of this.terminals.values()) terminal.kill(); this.terminals.clear() }
}
