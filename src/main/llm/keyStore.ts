/**
 * Secure per-provider storage for LLM API keys (issue #77).
 *
 * Each provider's key is encrypted with Electron `safeStorage` (which uses the
 * OS keychain / credential store where available) and persisted to a per-provider
 * file under the app's `userData` directory:
 *   `join(userData, `${providerId}-key.bin`)`
 * so the existing Anthropic key file stays `anthropic-key.bin` (backward
 * compatible). The plaintext key NEVER touches a log line, and the on-disk blob
 * is opaque ciphertext on platforms that support encryption.
 *
 * On platforms where `safeStorage` reports encryption unavailable (some Linux
 * setups with no keyring), we fall back to a base64 obfuscation so the app still
 * works — callers learn this via {@link isEncryptionAvailable} and the UI
 * surfaces it as a "stored, but not securely encrypted" warning.
 */
import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/** Marker prepended to the stored blob to record how it was encoded. */
const ENC_PREFIX = 'enc:'
const PLAIN_PREFIX = 'b64:'

/** Provider ids are filename components — keep them to a safe charset. */
function sanitizeProviderId(providerId: string): string {
  const safe = providerId.replace(/[^a-z0-9-]/gi, '')
  if (!safe) throw new Error('Invalid provider id')
  return safe
}

/** Absolute path to a provider's key file inside `userData`. */
function keyFilePath(providerId: string): string {
  return join(app.getPath('userData'), `${sanitizeProviderId(providerId)}-key.bin`)
}

/** Whether OS-backed encryption is available on this platform. */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Persist `key` for `providerId`, encrypted where possible. An empty/whitespace-
 * only key clears any stored key instead.
 */
export async function setKey(providerId: string, key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) {
    await clearKey(providerId)
    return
  }
  let blob: string
  if (isEncryptionAvailable()) {
    blob = ENC_PREFIX + safeStorage.encryptString(trimmed).toString('base64')
  } else {
    blob = PLAIN_PREFIX + Buffer.from(trimmed, 'utf8').toString('base64')
  }
  await fs.writeFile(keyFilePath(providerId), blob, { encoding: 'utf8', mode: 0o600 })
}

/** Read and decrypt `providerId`'s stored key, or `null` if none is set. */
export async function getKey(providerId: string): Promise<string | null> {
  let blob: string
  try {
    blob = await fs.readFile(keyFilePath(providerId), 'utf8')
  } catch {
    return null
  }
  try {
    if (blob.startsWith(ENC_PREFIX)) {
      const cipher = Buffer.from(blob.slice(ENC_PREFIX.length), 'base64')
      const value = safeStorage.decryptString(cipher).trim()
      return value || null
    }
    if (blob.startsWith(PLAIN_PREFIX)) {
      const value = Buffer.from(blob.slice(PLAIN_PREFIX.length), 'base64').toString('utf8').trim()
      return value || null
    }
    return null
  } catch {
    // Corrupt or undecryptable (e.g. keyring changed) — treat as no key.
    return null
  }
}

/** True when a non-empty key is stored for `providerId`. */
export async function hasKey(providerId: string): Promise<boolean> {
  return (await getKey(providerId)) !== null
}

/** Remove `providerId`'s stored key file (no-op if absent). */
export async function clearKey(providerId: string): Promise<void> {
  try {
    await fs.unlink(keyFilePath(providerId))
  } catch {
    // Already absent — nothing to do.
  }
}
