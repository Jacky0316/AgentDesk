import { describe, expect, it } from 'vitest'
import { parseProviderInput } from '../src/shared/config.js'

const compatibleProvider = {
  id: 'compatible-1', name: 'Compatible', kind: 'compatible', baseUrl: 'https://gateway.example.com/anthropic/', mainModel: 'model-main', fastModel: 'model-fast', capabilities: { thinking: true, effort: true, images: false, structuredOutput: true, toolUse: true }, customHeaders: { 'x-api-version': '2026-01-01' }, preserveSecret: true
}

describe('Provider configuration parsing', () => {
  it('accepts a valid Anthropic-compatible provider configuration', () => {
    expect(parseProviderInput(compatibleProvider)).toMatchObject(compatibleProvider)
  })

  it('rejects a malformed endpoint and oversized header key', () => {
    expect(() => parseProviderInput({ ...compatibleProvider, baseUrl: 'not a url' })).toThrow()
    expect(() => parseProviderInput({ ...compatibleProvider, customHeaders: { ['x'.repeat(201)]: 'value' } })).toThrow()
  })
})
