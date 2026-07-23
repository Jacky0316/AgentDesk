import { describe, expect, it } from 'vitest'
import { miniMaxMcpHost, withMiniMaxMcpCredentials } from '../src/main/providers.js'
import type { ProviderProfile } from '../src/shared/types.js'

function provider(baseUrl: string): ProviderProfile {
  return {
    id: 'minimax-token-plan', name: 'MiniMax Token Plan', kind: 'compatible', baseUrl,
    mainModel: 'MiniMax-M3', fastModel: '', hasApiKey: true, customHeaderNames: [],
    capabilities: { thinking: true, effort: true, images: true, structuredOutput: true, toolUse: true },
    createdAt: '', updatedAt: ''
  }
}

describe('MiniMax MCP configuration', () => {
  it('uses the China MCP host for a China-platform Token Plan key', () => {
    const profile = provider('https://api.minimaxi.com/anthropic')
    expect(miniMaxMcpHost(profile)).toBe('https://api.minimaxi.com')
    expect(withMiniMaxMcpCredentials({ minimax_web_search: { command: 'uvx' } }, profile, 'secret').minimax_web_search.env).toEqual({
      MINIMAX_API_KEY: 'secret', MINIMAX_API_HOST: 'https://api.minimaxi.com'
    })
  })

  it('uses the international MCP host for an international endpoint', () => {
    expect(miniMaxMcpHost(provider('https://api.minimax.io/anthropic'))).toBe('https://api.minimax.io')
  })
})
