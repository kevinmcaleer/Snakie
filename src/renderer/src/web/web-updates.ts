/**
 * Keeping the browser build up to date (#971).
 * =============================================================================
 *
 * app.snakie.org could keep serving an older build until you hard-reloaded it.
 * The cause was not HTTP caching — it was the service worker (#464), and two
 * halves of the same mistake:
 *
 *  1. `registerType: 'autoUpdate'` was silently inert. vite-plugin-pwa only
 *     turns it into `skipWaiting` + `clientsClaim` when `injectRegister` is
 *     `'auto'` or absent, and we set `'script'` (to keep the registration out of
 *     an inline script the strict CSP rejects). So Workbox emitted a worker that
 *     activates only when the page posts it `SKIP_WAITING`, and never claims.
 *  2. Nothing ever posted that message, because the injected registration was a
 *     bare `navigator.serviceWorker.register(…)` with no update handling.
 *
 * A new deploy therefore installed and then sat in `waiting` until every tab of
 * the origin closed — which, for the tab you keep the IDE open in, is never —
 * while each navigation kept being answered from the OLD precache. A hard reload
 * worked because it is the one thing that bypasses the worker.
 *
 * The config now sets both flags explicitly, so a new worker activates and takes
 * over. This module does the other half: it registers the worker (from our own
 * bundle, which IS `'self'`, so the CSP reason for `injectRegister: 'script'`
 * still holds) and reacts when a new build lands.
 *
 * WHAT IT DOES WHEN A NEW BUILD LANDS. It reloads — but only when nothing is
 * unsaved. Snakie is an editor; silently reloading over someone's unsaved buffer
 * would be a worse bug than the one being fixed. With work in progress it says
 * so instead, through the same `UpdateNotifier` the desktop app uses, and the
 * reload waits for the user. On a fresh visit there is nothing unsaved, which is
 * the case the report was actually about: open the site, get the current build.
 */
import type { UpdateStatus } from '../../../preload/index.d'
import { hasUnsavedWork } from '../lib/unsaved-work'

/** Where the build stamps its version. Emitted by `vite.web.config.ts`. */
export const VERSION_URL = '/version.json'

/** The service worker vite-plugin-pwa generates, at the scope it claims. */
export const SW_URL = '/sw.js'
export const SW_SCOPE = '/'

/** How often to ask whether a new build has been deployed. */
export const POLL_INTERVAL_MS = 30 * 60 * 1000

/** What `version.json` holds. */
export interface VersionStamp {
  version: string
  builtAt: string
}

type Listener = (status: UpdateStatus) => void

/**
 * Compare the running build against a deployed one. A pure string compare, not a
 * semver ordering: any difference means the server is serving something else,
 * and rolling BACK a bad deploy has to reach people just as fast as rolling out.
 */
export function isDifferentBuild(running: string, deployed: string | undefined): boolean {
  return !!deployed && !!running && deployed !== running
}

/**
 * Read the deployed version stamp, bypassing every cache.
 *
 * `cache: 'no-store'` is the point of the request: the whole failure mode being
 * fixed is a stale copy of something, so a check that can itself be answered
 * from cache would report "up to date" forever.
 */
export async function fetchDeployedVersion(
  fetchImpl: typeof fetch = fetch,
  url = VERSION_URL
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' })
    if (!res.ok) return undefined
    const stamp = (await res.json()) as Partial<VersionStamp>
    return typeof stamp.version === 'string' ? stamp.version : undefined
  } catch {
    // Offline, or the file isn't deployed yet. Not knowing is not an error —
    // the service worker is the primary signal; this is the belt to its braces.
    return undefined
  }
}

/**
 * The web `updates` namespace, matching the preload contract the UI already
 * speaks so `UpdateNotifier` and the status bar need no web-specific wiring.
 *
 * `download` resolves immediately and does nothing: on the web the new build is
 * already on the server and, by the time we say anything, already precached.
 * There is no download step to opt into — only a reload to apply.
 */
export function createWebUpdatesApi(runningVersion: string): {
  check(): Promise<void>
  download(): Promise<void>
  quitAndInstall(): Promise<void>
  onStatus(cb: Listener): () => void
} {
  const listeners = new Set<Listener>()
  let registration: ServiceWorkerRegistration | null = null
  /** At most one reload per page load, whatever fires first. */
  let applied = false
  /** Don't nag: once announced, later signals about the same build are quiet. */
  let announced = false

  const emit = (status: UpdateStatus): void => {
    for (const l of listeners) l(status)
  }

  const apply = (): void => {
    if (applied) return
    applied = true
    // A normal reload revalidates the top-level document, and the newly
    // activated worker answers it from the NEW precache. No cache-busting query
    // is needed, and adding one would leave a junk URL in the address bar.
    window.location.reload()
  }

  /** A newer build is ready to run. Take it now, or offer it. */
  const onNewBuild = (version?: string): void => {
    if (applied) return
    if (!hasUnsavedWork()) {
      apply()
      return
    }
    if (announced) return
    announced = true
    // 'downloaded' is the lifecycle state that means "ready, apply when you
    // like" — exactly where a claimed worker leaves us. UpdateNotifier words it
    // for the web (reload, not restart) off the same status.
    emit({ state: 'downloaded', version })
  }

  const watchInstalling = (worker: ServiceWorker | null): void => {
    if (!worker) return
    worker.addEventListener('statechange', () => {
      // `controller` is null on the very FIRST install, when there is no older
      // build to replace — that is a new visitor, not an update, and reloading
      // them would be a gratuitous flash.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        void fetchDeployedVersion().then(onNewBuild)
      }
    })
  }

  const poll = async (): Promise<void> => {
    // Ask the worker to re-check first: it is the authoritative signal, and it
    // also refreshes the precache so a reload has something to land on.
    try {
      await registration?.update()
    } catch {
      // A failed update check is a network problem, not ours to report.
    }
    const deployed = await fetchDeployedVersion()
    if (isDifferentBuild(runningVersion, deployed)) onNewBuild(deployed)
  }

  const start = (): void => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      // No worker (Safari private browsing, an insecure origin): the version
      // poll alone still notices a deploy and offers the reload.
      window.setInterval(() => void poll(), POLL_INTERVAL_MS)
      return
    }
    void navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE })
      .then((reg) => {
        registration = reg
        // Already waiting when we arrived — installed during a previous visit
        // that never applied it.
        if (reg.waiting && navigator.serviceWorker.controller) {
          void fetchDeployedVersion().then(onNewBuild)
        }
        watchInstalling(reg.installing)
        reg.addEventListener('updatefound', () => watchInstalling(reg.installing))
      })
      .catch(() => {
        // Registration can fail outright (storage blocked, an unsupported
        // context). The poll below still covers the "am I stale?" question.
      })
    window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    // Coming back to a tab left open for days is exactly when the running build
    // is most likely to be old, and is a moment the user is already looking.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void poll()
    })
  }

  start()

  return {
    check: async (): Promise<void> => {
      await poll()
    },
    download: async (): Promise<void> => {
      // Nothing to download — see the note above.
    },
    quitAndInstall: async (): Promise<void> => {
      applied = false // an explicit request always applies
      apply()
    },
    onStatus: (cb: Listener): (() => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
