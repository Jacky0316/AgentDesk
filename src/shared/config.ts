import { z } from 'zod'
import type { ProviderInput } from './types.js'

const capabilitiesSchema = z.object({
  thinking: z.boolean(),
  effort: z.boolean(),
  images: z.boolean(),
  structuredOutput: z.boolean(),
  toolUse: z.boolean()
})

/** Boundary validation for Renderer-to-main Provider configuration IPC. */
export const providerInputSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['anthropic', 'deepseek', 'compatible']),
  baseUrl: z.url().max(500),
  mainModel: z.string().trim().max(200),
  fastModel: z.string().trim().max(200),
  capabilities: capabilitiesSchema,
  apiKey: z.string().max(10_000).optional(),
  customHeaders: z.record(z.string().max(200), z.string().max(10_000)).optional(),
  preserveSecret: z.boolean().optional()
})

export function parseProviderInput(input: unknown): ProviderInput {
  return providerInputSchema.parse(input) as ProviderInput
}
