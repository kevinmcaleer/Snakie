import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import {
  copilotProvider,
  grokProvider,
  localProvider,
  openaiProvider
} from './openaiCompatible'
import type { Provider, ProviderInfo } from './types'

const PROVIDERS: Provider[] = [
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  grokProvider,
  copilotProvider,
  localProvider
]

const BY_ID = new Map<string, Provider>(PROVIDERS.map((p) => [p.info.id, p]))

export const DEFAULT_PROVIDER_ID = anthropicProvider.info.id

export function getProvider(id: string): Provider | undefined {
  return BY_ID.get(id)
}

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map((p) => p.info)
}
