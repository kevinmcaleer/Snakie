/**
 * Sign in with kevsrobots on the WEB (#1310, Chatter#80).
 * =============================================================================
 * Mirrors the desktop (src/main/kevsrobots/ipc.ts) with the same shared client
 * (shared/kevsrobots-account.ts). Differences:
 *
 *  - Sign-in opens accounts.kevsrobots.com in a POPUP, so the editor tab (and
 *    anything unsaved in it) stays put. The popup comes back to
 *    app.snakie.org/auth/callback, which hands the address over by postMessage
 *    / BroadcastChannel (auth-callback-main.ts) and closes.
 *  - Tokens live in this browser's localStorage. They only allow listing your
 *    projects and sending wiring to them, for an hour at a time; signing out
 *    (or Disconnect on your kevsrobots account page) ends them.
 */
import {
  KR_WEB_REDIRECT_URI,
  KevsrobotsClient,
  authorizeUrl,
  exchangeCode,
  parseCallback,
  pkceChallenge,
  randomUrlSafe,
  type KevsrobotsApi,
  type KrResult,
  type KrStatus,
  type KrTokens,
  type TokenStore
} from '../../../shared/kevsrobots-account'
import { KR_SIGN_IN_CHANNEL } from './web-kevsrobots-channel'

const STORAGE_KEY = 'snakie.kevsrobots.tokens'
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

const store: TokenStore = {
  async load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as KrTokens) : null
    } catch {
      return null
    }
  },
  async save(tokens) {
    try {
      if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage blocked (private window): the sign-in lasts until the tab closes.
    }
  }
}

/** Wait for the popup to report the redirect address, or to be closed. */
function waitForCallback(popup: Window): Promise<string | null> {
  return new Promise((resolve) => {
    let channel: BroadcastChannel | null = null
    const done = (url: string | null): void => {
      clearInterval(poll)
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      channel?.close()
      resolve(url)
    }
    const accept = (data: unknown): void => {
      const d = data as { type?: string; url?: string } | null
      if (d?.type === KR_SIGN_IN_CHANNEL && typeof d.url === 'string') done(d.url)
    }
    const onMessage = (e: MessageEvent): void => {
      if (e.origin === window.location.origin) accept(e.data)
    }
    window.addEventListener('message', onMessage)
    try {
      channel = new BroadcastChannel(KR_SIGN_IN_CHANNEL)
      channel.onmessage = (e): void => accept(e.data)
    } catch {
      channel = null
    }
    const poll = setInterval(() => {
      // Closed without coming back: cancelled. Give a late message a moment first.
      if (popup.closed) setTimeout(() => done(null), 500)
    }, 500)
    const timer = setTimeout(() => done(null), SIGN_IN_TIMEOUT_MS)
  })
}

export function createWebKevsrobotsApi(): KevsrobotsApi {
  const fetchFn = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init)
  const client = new KevsrobotsClient(store, fetchFn)
  let signingIn: Promise<KrResult<KrStatus>> | null = null

  const signIn = async (): Promise<KrResult<KrStatus>> => {
    // Open the popup FIRST, inside the click, so the browser doesn't block it;
    // the address is filled in once the PKCE challenge is ready.
    const popup = window.open('', 'kevsrobots-sign-in', 'popup,width=520,height=720')
    if (!popup) return { ok: false, error: 'Your browser blocked the sign-in window. Allow pop-ups for app.snakie.org and try again.' }
    try {
      const verifier = randomUrlSafe(48)
      const state = randomUrlSafe(16)
      popup.location.href = authorizeUrl({
        redirectUri: KR_WEB_REDIRECT_URI,
        challenge: await pkceChallenge(verifier),
        state
      })
      const url = await waitForCallback(popup)
      if (!url) return { ok: false, error: 'Sign-in was cancelled.' }
      const back = parseCallback(url, state)
      if ('error' in back) return { ok: false, error: back.error }
      const tokens = await exchangeCode(fetchFn, { code: back.code, verifier, redirectUri: KR_WEB_REDIRECT_URI })
      return { ok: true, value: await client.signedIn(tokens) }
    } catch (err) {
      try {
        popup.close()
      } catch {
        // already closed
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    status: () => client.status(),
    signIn: () => {
      signingIn ??= signIn().finally(() => {
        signingIn = null
      })
      return signingIn
    },
    signOut: () => client.signOut(),
    listProjects: () => client.listProjects(),
    sendWiring: (payload) => client.sendWiring(payload),
    createProject: (payload) => client.createProject(payload),
    sendRobot: (payload) => client.sendRobot(payload)
  }
}
