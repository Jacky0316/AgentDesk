import type { AgentDeskApi } from '../../shared/types'

declare global {
  interface Window { agentDesk: AgentDeskApi }
}

export {}
