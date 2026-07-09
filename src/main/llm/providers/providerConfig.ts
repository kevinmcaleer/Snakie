import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

interface OpenAiModelList {
  data?: Array<{ id: string }>
}

function configFilePath(providerId: string): string {
  const safe = providerId.replace(/[^a-z0-9-]/gi, '')
  if (!safe) throw new Error('Invalid provider id')
  return join(app.getPath('userData'), `${safe}-config.json`)
}

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
