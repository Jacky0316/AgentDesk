import type { McpServerInput, ProviderInput, ProviderProfile } from '../shared/types.js'

export const providerPresets: ProviderInput[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    mainModel: '',
    fastModel: '',
    capabilities: { thinking: true, effort: true, images: true, structuredOutput: true, toolUse: true },
    preserveSecret: true
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    mainModel: 'deepseek-v4-pro[1m]',
    fastModel: 'deepseek-v4-flash',
    capabilities: { thinking: true, effort: true, images: false, structuredOutput: true, toolUse: true },
    preserveSecret: true
  }
]

export function providerEnvironment(profile: ProviderProfile, apiKey: string, customHeaders: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'agentdesk/0.1.0',
    ANTHROPIC_BASE_URL: profile.baseUrl,
    ANTHROPIC_MODEL: profile.mainModel || undefined,
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.mainModel || undefined,
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.mainModel || undefined,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.fastModel || profile.mainModel || undefined,
    CLAUDE_CODE_SUBAGENT_MODEL: profile.fastModel || profile.mainModel || undefined
  }

  if (profile.kind === 'anthropic') env.ANTHROPIC_API_KEY = apiKey
  else env.ANTHROPIC_AUTH_TOKEN = apiKey
  if (Object.keys(customHeaders).length) {
    env.ANTHROPIC_CUSTOM_HEADERS = Object.entries(customHeaders).map(([key, value]) => `${key}: ${value}`).join('\n')
  }
  return env
}

/** MiniMax Token Plan exposes web search through its own MCP server, rather
 * than through Anthropic's server-side WebSearch/WebFetch tools. */
export function isMiniMaxProvider(profile: ProviderProfile): boolean {
  return /minimax/i.test(`${profile.id} ${profile.name} ${profile.baseUrl}`)
}

/** Token Plan keys are region-bound. China platform uses api.minimaxi.com;
 * the international platform uses api.minimax.io. */
export function miniMaxMcpHost(profile: ProviderProfile): string {
  return /(?:^|\.)minimaxi\.com(?:\/|$)/i.test(profile.baseUrl)
    ? 'https://api.minimaxi.com'
    : 'https://api.minimax.io'
}

/** Keep the Provider key in Electron safeStorage and inject it only when the
 * child MCP process starts. It is never persisted in task JSON. */
export function withMiniMaxMcpCredentials(servers: Record<string, McpServerInput>, profile: ProviderProfile, apiKey: string): Record<string, McpServerInput> {
  if (!isMiniMaxProvider(profile) || !servers.minimax_web_search) return servers
  const server = servers.minimax_web_search
  return {
    ...servers,
    minimax_web_search: {
      ...server,
      env: {
        ...server.env,
        MINIMAX_API_KEY: apiKey,
        MINIMAX_API_HOST: miniMaxMcpHost(profile)
      }
    }
  }
}
