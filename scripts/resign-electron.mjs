/**
 * Re-sign the Electron DEV binary with a fresh local ad-hoc signature (#708).
 *
 * Apple's revocation list includes the stock ad-hoc `Electron.app` hash for
 * electron 31.x — malware shipped on the same byte-identical runtime, and a
 * hash revocation cannot tell the two apart — so on macOS 26+ launching the
 * npm-downloaded binary dies with a "contains malware" dialog (spctl verdict:
 * "notarization indicates this code has been revoked"). Re-signing gives the
 * local copy a hash the revocation list has never seen, which launches fine.
 *
 * Signing an unverified binary would be the wrong move; this one is safe
 * because `@electron/get` verifies the download against Electron's official
 * SHASUMS256 before it ever lands in `dist/`. The real fix is upgrading off
 * EOL Electron 31 (#708) — delete this script when that lands.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../node_modules/electron/dist/Electron.app', import.meta.url))

if (process.platform === 'darwin' && existsSync(app)) {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  console.log('[resign-electron] Electron.app re-signed with a local ad-hoc signature (#708)')
}
