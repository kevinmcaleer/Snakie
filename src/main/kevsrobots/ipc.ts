import { ipcMain, shell } from 'electron'
import { createServer, type Server } from 'http'
import {
  KR_LOOPBACK_PATH,
  KevsrobotsClient,
  authorizeUrl,
  exchangeCode,
  parseCallback,
  pkceChallenge,
  randomUrlSafe,
  type KrResult,
  type KrNewProject,
  type KrSendRobot,
  type KrSendWiring,
  type KrStatus,
  type KrTokens,
  type TokenStore
} from '../../shared/kevsrobots-account'
import { clearKey, getKey, setKey } from '../llm/keyStore'

/**
 * Sign in with kevsrobots on the DESKTOP (#1310, Chatter#80).
 *
 * Optional: nothing here runs until someone chooses "Send to kevsrobots".
 * Sign-in opens the system browser (never an embedded web view) at
 * accounts.kevsrobots.com and listens once on a loopback address,
 * `http://127.0.0.1:<free port>/callback` (RFC 8252), for the redirect back.
 * Tokens are kept with Electron safeStorage (the OS keychain where there is
 * one), through the same store as the LLM keys, and never reach the renderer.
 */

const STORE_ID = 'kevsrobots'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

const store: TokenStore = {
  async load() {
    const raw = await getKey(STORE_ID)
    if (!raw) return null
    try {
      return JSON.parse(raw) as KrTokens
    } catch {
      return null
    }
  },
  async save(tokens) {
    if (tokens) await setKey(STORE_ID, JSON.stringify(tokens))
    else await clearKey(STORE_ID)
  }
}

const client = new KevsrobotsClient(store, (input, init) => fetch(input, init))

const PAGE = (title: string, line: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1c2230;background:#f7f7f4">` +
  `<div style="text-align:center"><h1 style="font-size:22px">${title}</h1><p>${line}</p></div></body>`

/** Listen on a free loopback port for one redirect, then close. */
function waitForRedirect(): Promise<{ redirectUri: string; result: Promise<string> }> {
  return new Promise((resolveStart, rejectStart) => {
    let server: Server | null = null
    let settle: ((url: string) => void) | null = null
    let fail: ((err: Error) => void) | null = null
    const result = new Promise<string>((res, rej) => {
      settle = res
      fail = rej
    })
    const timer = setTimeout(() => {
      server?.close()
      fail?.(new Error('Sign-in timed out. Try again when you are ready.'))
    }, SIGN_IN_TIMEOUT_MS)
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== KR_LOOPBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      const ok = url.searchParams.has('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(
        ok
          ? PAGE("You're signed in", 'You can close this tab and go back to Snakie.')
          : PAGE('Sign-in stopped', 'Nothing was shared. You can close this tab and go back to Snakie.')
      )
      clearTimeout(timer)
      server?.close()
      settle?.(`http://127.0.0.1${req.url ?? ''}`)
    })
    server.on('error', (err) => rejectStart(err))
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      if (!addr || typeof addr === 'string') {
        rejectStart(new Error('Could not open a local port for sign-in.'))
        return
      }
      resolveStart({ redirectUri: `http://127.0.0.1:${addr.port}${KR_LOOPBACK_PATH}`, result })
    })
  })
}

let signingIn: Promise<KrResult<KrStatus>> | null = null

async function signIn(): Promise<KrResult<KrStatus>> {
  try {
    const verifier = randomUrlSafe(48)
    const state = randomUrlSafe(16)
    const { redirectUri, result } = await waitForRedirect()
    await shell.openExternal(authorizeUrl({ redirectUri, challenge: await pkceChallenge(verifier), state }))
    const back = parseCallback(await result, state)
    if ('error' in back) return { ok: false, error: back.error }
    const tokens = await exchangeCode((i, init) => fetch(i, init), { code: back.code, verifier, redirectUri })
    return { ok: true, value: await client.signedIn(tokens) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerKevsrobotsIpc(): void {
  ipcMain.handle('kevsrobots:status', () => client.status())
  ipcMain.handle('kevsrobots:signIn', () => {
    // A second click while the browser is open joins the same sign-in.
    signingIn ??= signIn().finally(() => {
      signingIn = null
    })
    return signingIn
  })
  ipcMain.handle('kevsrobots:signOut', () => client.signOut())
  ipcMain.handle('kevsrobots:listProjects', () => client.listProjects())
  ipcMain.handle('kevsrobots:sendWiring', (_e, payload: KrSendWiring) => client.sendWiring(payload))
  ipcMain.handle('kevsrobots:createProject', (_e, payload: KrNewProject) => client.createProject(payload))
  ipcMain.handle('kevsrobots:sendRobot', (_e, payload: KrSendRobot) => client.sendRobot(payload))
}
