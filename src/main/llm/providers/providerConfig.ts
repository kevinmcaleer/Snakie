/**
 * Simple JSON file-based per-provider config store.
 *
 * Persists non-sensitive per-provider settings (currently just the local
 * provider's base URL and model name) at `<userData>/<providerId>-config.json`.
 * API keys live in the encrypted key-store (`keyStore.ts`), not here.
 *
 * The base URL is expected to point at the root of an OpenAI-compatible server,
 * **including** the `/v1` segment if present — e.g.
 * `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1`
 * (LM Studio).  The trailing slash is stripped before appending
 * `/chat/completions` or `/models`.
 *
 * When the local server is not running, requests fail with a connection-refused
 * error that surfaces in the chat panel — this is the most common failure mode
 * for Ollama / LM Studio users and does not need special handling beyond a
 * clear message.
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/** Shape of the `/v1/models` response (only the fields we read). */
interface OpenAiModelList {
  data?: Array<{ id: string }>
}

/**
 * Build the filesystem path for a provider's config JSON file. The provider id
 * is sanitised to safe characters to avoid path-traversal issues.
 */
function configFilePath(providerId: string): string {
  const safe = providerId.replace(/[^a-z0-9-]/gi, '')
  if (!safe) throw new Error('Invalid provider id')
  return join(app.getPath('userData'), `${safe}-config.json`)
}

/**
 * Read the persisted config for a provider. Returns an empty object when no
 * config file exists yet (first run).
 */
export async function getProviderConfig(
  providerId: string
): Promise<Record<string, string>> {
  try {
    const data = await fs.readFile(configFilePath(providerId), 'utf-8')
    return JSON.parse(data) as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Persist the config for a provider, overwriting any previous values. Empty
 * string values are stripped before writing.
 */
export async function setProviderConfig(
  providerId: string,
  config: Record<string, string>
): Promise<void> {
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(config)) {
    if (v) cleaned[k] = v
  }
  await fs.writeFile(configFilePath(providerId), JSON.stringify(cleaned, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
}

/**
 * Fetch available models from an OpenAI-compatible `/v1/models` endpoint.
 * Returns the model id strings, or throws with a descriptive error.
 */
export async function fetchAvailableModels(baseURL: string): Promise<string[]> {
  const url = baseURL.replace(/\/+$/, '') + '/models'
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to fetch models (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as OpenAiModelList
  const models = (json.data ?? []).map((m) => m.id).filter(Boolean)
  if (models.length === 0) throw new Error('No models returned by server')
  return models.sort()
}
