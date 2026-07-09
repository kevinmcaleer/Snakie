import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

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
