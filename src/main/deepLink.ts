import { app, ipcMain, type BrowserWindow } from 'electron'
import { resolve } from 'path'
import {
  DEEP_LINK_SCHEME,
  deepLinkFromArgv,
  parseDeepLink,
  type DeepLinkPayload
} from '../shared/deep-link'

/**
 * `snakie://open…` LINKS INTO THE DESKTOP APP (kevsrobots.com#581).
 * =============================================================================
 *
 * "Open in Snakie" on a kevsrobots lesson can hand its code to the desktop app
 * instead of app.snakie.org. The link reaches us three ways:
 *
 *  - macOS: the `open-url` event (before or after `ready`);
 *  - Windows / Linux, Snakie not running: in this process's `argv`;
 *  - Windows / Linux, Snakie already running: a second instance starts, sees
 *    it can't take the single-instance lock, and quits; we get its `argv` in
 *    `second-instance`.
 *
 * Each link is queued until the editor is listening. The renderer takes the
 * queue when it mounts (`app:takeOpenLinks`) and is pushed later ones on
 * `app:openLink`; it opens each as a new unsaved tab, as the web app does.
 */

const pending: DeepLinkPayload[] = []
/** True once the editor has taken the queue, until it next reloads. */
let listening = false
let getWindow: () => BrowserWindow | null = () => null

function focus(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function deliver(url: string | null): void {
  const payload = parseDeepLink(url)
  if (!payload) return
  const win = getWindow()
  if (listening && win && !win.isDestroyed()) {
    win.webContents.send('app:openLink', payload)
    focus(win)
  } else {
    pending.push(payload)
  }
}

/** Hosts the renderer may read a shared program from (its CSP can't reach them). */
const GITHUB_TEXT_RE =
  /^https:\/\/(?:raw\.githubusercontent\.com|gist\.githubusercontent\.com|api\.github\.com\/gists)\//

/**
 * Call once, at start-up, BEFORE `app.whenReady()` (macOS can deliver
 * `open-url` before ready). Returns false when another Snakie already holds the
 * single-instance lock: it has been handed our link, and this one should quit.
 */
export function initDeepLinks(windowGetter: () => BrowserWindow | null): boolean {
  getWindow = windowGetter
  if (!app.requestSingleInstanceLock()) return false

  // A packaged build registers the scheme with the OS (electron-builder's
  // `protocols` does it at install time on macOS and Linux; this covers
  // Windows and re-asserts it after an update). A dev build doesn't, so
  // `npm run dev` never takes the links from the installed app.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  } else if (process.env.SNAKIE_DEV_PROTOCOL && process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1])])
  }

  app.on('open-url', (event, url) => {
    event.preventDefault()
    deliver(url)
  })
  app.on('second-instance', (_event, argv) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) focus(win)
    deliver(deepLinkFromArgv(argv))
  })
  deliver(deepLinkFromArgv(process.argv))

  ipcMain.handle('app:takeOpenLinks', () => {
    listening = true
    return pending.splice(0, pending.length)
  })

  // The renderer's CSP blocks outbound requests, so when a link names a gist
  // or repo file without carrying its code, main fetches it — from GitHub's
  // raw and gist hosts only.
  ipcMain.handle('app:fetchGithubText', async (_e, url: unknown) => {
    if (typeof url !== 'string' || !GITHUB_TEXT_RE.test(url)) {
      return { ok: false, status: 400, body: '' }
    }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Snakie' } })
      return { ok: res.ok, status: res.status, body: await res.text() }
    } catch {
      return { ok: false, status: 0, body: '' }
    }
  })
  return true
}

/** A reload drops the editor's listener: queue links until it asks again. */
export function watchDeepLinkWindow(win: BrowserWindow): void {
  win.webContents.on('did-start-loading', () => {
    listening = false
  })
}
