/**
 * Secure storage for the user's Anthropic API key.
 *
 * The key is encrypted with Electron `safeStorage` (which uses the OS keychain /
 * credential store where available) and persisted to a file under the app's
 * `userData` directory. The plaintext key NEVER touches a log line, and the
 * on-disk blob is opaque ciphertext on platforms that support encryption.
 *
 * On platforms where `safeStorage` reports encryption unavailable (some Linux
 * setups with no keyring), we fall back to a base64 obfuscation so the app
 * still works — callers learn this via {@link isEncryptionAvailable} and the UI
 * surfaces it as a "stored, but not securely encrypted" warning.
 */
import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/** Marker prepended to the stored blob to record how it was encoded. */
const ENC_PREFIX = 'enc:'
const PLAIN_PREFIX = 'b64:'

/** Absolute path to the key file inside `userData`. */
function keyFilePath(): string {
  return join(app.getPath('userData'), 'anthropic-key.bin')
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
 * Persist `key` to disk, encrypted where possible. An empty/whitespace-only key
 * clears any stored key instead.
 */
export async function setKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) {
    await clearKey()
    return
  }
  let blob: string
  if (isEncryptionAvailable()) {
    blob = ENC_PREFIX + safeStorage.encryptString(trimmed).toString('base64')
  } else {
    blob = PLAIN_PREFIX + Buffer.from(trimmed, 'utf8').toString('base64')
  }
  await fs.writeFile(keyFilePath(), blob, { encoding: 'utf8', mode: 0o600 })
}

/** Read and decrypt the stored key, or `null` if none is set. */
export async function getKey(): Promise<string | null> {
  let blob: string
  try {
    blob = await fs.readFile(keyFilePath(), 'utf8')
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

/** True when a non-empty key is stored. */
export async function hasKey(): Promise<boolean> {
  return (await getKey()) !== null
}

/** Remove the stored key file (no-op if absent). */
export async function clearKey(): Promise<void> {
  try {
    await fs.unlink(keyFilePath())
  } catch {
    // Already absent — nothing to do.
  }
}
