/**
 * Provider registry (issue #77).
 *
 * The single place that knows about every LLM backend. `getProvider(id)` routes
 * a request to the right implementation; `listProviders()` gives the renderer
 * the metadata it needs to render the provider/model/effort/speed dropdowns and
 * per-provider key settings.
 *
 * The order here is the order shown in the UI — Anthropic first (the default and
 * the only locally-testable provider), then the rest.
 */
import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import { copilotProvider, grokProvider, openaiProvider } from './openaiCompatible'
import type { Provider, ProviderInfo } from './types'

/** All registered providers, in display order. */
const PROVIDERS: Provider[] = [
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  grokProvider,
  copilotProvider
]

const BY_ID = new Map<string, Provider>(PROVIDERS.map((p) => [p.info.id, p]))

/** The default provider id when none is selected. */
export const DEFAULT_PROVIDER_ID = anthropicProvider.info.id

/** Look up a provider by id, or `undefined` if unknown. */
export function getProvider(id: string): Provider | undefined {
  return BY_ID.get(id)
}

/** Renderer-facing metadata for every provider, in display order. */
export function listProviders(): ProviderInfo[] {
  return PROVIDERS.map((p) => p.info)
}
