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
 * WHAT IT DOES WHEN A NEW BUILD LANDS. It SUGGESTS a reload, through the same
 * `UpdateNotifier` the desktop app uses, and waits for the user — the way
 * BetterCad does. A reload in the middle of a session would drop the board
 * connection and the shell, so it is never forced on someone who is working.
 *
 * Taking the reload loses nothing: immediately before it, every open tab —
 * unsaved edits, untitled buffers and board files included — is written to a
 * one-shot snapshot (`store/reload-snapshot.ts`) that the next boot restores.
 *
 * The one exception is the first few seconds after the page loads, with nothing
 * unsaved: that is a fresh visit that was answered from the old precache, the
 * case #971 was actually about, and there the reload just happens — open the
 * site, get the current build, no prompt.
 *
 * RELOAD ONLY ONCE THE NEW WORKER HAS TAKEN OVER. A new worker reaches
 * `installed` and then, with `skipWaiting`, replaces the old one a moment
 * later. Reloading in between (which is what this module used to do, the instant
 * it saw `installed`) sends the navigation to the OLD worker just as it is being
 * shut down: the request is cut off ("Failed to fetch" from workbox in sw.js),
 * the new page never arrives, and the tab sits there frozen. Every deploy could
 * do that to a tab opened in the 30 seconds before it, and on 2026-11-21, with
 * four deploys in an hour, it did. So the reload waits for `controllerchange`:
 * the new worker active and in charge of this page.
 *
 * And if no new worker ever takes over (its ~47 MB precache is all or nothing,
 * so one dropped request fails the install), a plain reload would be answered
 * by the old worker with the old build. Then the reload first unregisters it,
 * which is what a hard reload does by hand.
 */
import type { UpdateStatus } from '../../../preload/index.d'
import { hasUnsavedWork, saveWorkForReload } from '../lib/unsaved-work'

/** Where the build stamps its version. Emitted by `vite.web.config.ts`. */
export const VERSION_URL = '/version.json'

/** The service worker vite-plugin-pwa generates, at the scope it claims. */
export const SW_URL = '/sw.js'
export const SW_SCOPE = '/'

/** How often to ask whether a new build has been deployed. */
export const POLL_INTERVAL_MS = 30 * 60 * 1000

/**
 * How long after the page loads a new build may be applied without asking.
 * Long enough for a fresh visit's service worker to install and notice it is
 * stale; short enough that nobody has started real work yet.
 */
export const BOOT_GRACE_MS = 30 * 1000

/**
 * Whether a new build should be applied straight away rather than offered (pure).
 * Only on a fresh page with nothing unsaved; everything else gets the prompt.
 */
export function shouldApplyQuietly(sinceLoadMs: number, unsaved: boolean): boolean {
  return !unsaved && sinceLoadMs >= 0 && sinceLoadMs < BOOT_GRACE_MS
}

/** What `version.json` holds. */
export interface VersionStamp {
  version: string
  builtAt: string
}

type Listener = (status: UpdateStatus) => void

/** How long a reload waits for a new worker that is still installing or activating. */
export const TAKEOVER_WAIT_MS = 15 * 1000

/**
 * How to reload into a new build (pure).
 *  - `reload`: no worker, or a new one took over this page and none is behind
 *    it, so the reload is answered by the right build.
 *  - `wait`: a new worker is on its way (installing, waiting or activating).
 *    Reloading now hands the navigation to the old worker as it shuts down, and
 *    the tab freezes; wait for it to take over. Checked first, because a later
 *    deploy can be on its way even after an earlier one took over.
 *  - `bypass`: no new worker is coming (its install failed). The old worker
 *    would serve the old build again, so unregister it first.
 */
export function reloadPlan(state: {
  registered: boolean
  tookOver: boolean
  newWorkerPending: boolean
}): 'reload' | 'wait' | 'bypass' {
  if (!state.registered) return 'reload'
  if (state.newWorkerPending) return 'wait'
  return state.tookOver ? 'reload' : 'bypass'
}

/** Whether a registration has a newer worker on its way in. */
function hasPendingWorker(reg: ServiceWorkerRegistration): boolean {
  return !!(reg.installing || reg.waiting || reg.active?.state === 'activating')
}

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
  /** A new worker activated and claimed this page, so a reload lands on its precache. */
  let tookOver = false

  const emit = (status: UpdateStatus): void => {
    for (const l of listeners) l(status)
  }

  /**
   * Resolves when the worker on its way is done (in charge, or failed), or
   * after `ms`. Its own `statechange` covers the case where it already claimed
   * this page and is only finishing activation.
   */
  const waitForTakeover = (reg: ServiceWorkerRegistration, ms: number): Promise<void> =>
    new Promise((resolve) => {
      const worker =
        reg.installing ?? reg.waiting ?? (reg.active?.state === 'activating' ? reg.active : null)
      const done = (): void => {
        window.clearTimeout(timer)
        worker?.removeEventListener('statechange', onState)
        resolve()
      }
      const onState = (): void => {
        if (worker && (worker.state === 'activated' || worker.state === 'redundant')) done()
      }
      const timer = window.setTimeout(done, ms)
      worker?.addEventListener('statechange', onState)
    })

  const apply = async (): Promise<void> => {
    if (applied) return
    applied = true
    // Keep the open tabs (and any unsaved edits) for the next boot. The explicit
    // Reload button has already done this and asked if it failed (see
    // `applyUpdateKeepingWork`); the quiet path only runs with nothing unsaved.
    saveWorkForReload()
    // A normal reload revalidates the top-level document, and the newly
    // activated worker answers it from the NEW precache. No cache-busting query
    // is needed, and adding one would leave a junk URL in the address bar. But
    // only once that worker is in charge (see the note at the top).
    const reg = registration
    const plan = (): ReturnType<typeof reloadPlan> =>
      reloadPlan({
        registered: !!reg,
        tookOver,
        newWorkerPending: !!reg && hasPendingWorker(reg)
      })
    if (reg && plan() === 'wait') await waitForTakeover(reg, TAKEOVER_WAIT_MS)
    if (reg && plan() !== 'reload') {
      // Never took over (failed install, or stuck): go around the old worker.
      try {
        await reg.unregister()
      } catch {
        /* the reload still happens; at worst it lands on the old build */
      }
    }
    window.location.reload()
  }

  /** A newer build is ready to run. Take it now on a fresh page, else offer it. */
  const onNewBuild = (version?: string): void => {
    if (applied) return
    if (shouldApplyQuietly(performance.now(), hasUnsavedWork())) {
      void apply()
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
      //
      // NOT at `installed`: the worker still has to replace the old one, and a
      // reload in that gap freezes the tab. `controllerchange` (in `start`) is
      // the signal that it has.
      //
      // `redundant` without taking over means the install FAILED (one precache
      // request dropped). The old worker stays in charge; if the server has
      // moved on, offer the reload anyway, and `apply` goes around the old one.
      if (worker.state === 'redundant' && navigator.serviceWorker.controller && !tookOver) {
        void fetchDeployedVersion().then((deployed) => {
          if (isDifferentBuild(runningVersion, deployed)) onNewBuild(deployed)
        })
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
    // A new worker on its way reports back itself (controllerchange, or
    // redundant if it failed); reloading now would only cut it short.
    if (registration && hasPendingWorker(registration)) return
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
    // A page that started under a worker and now has a new one: the update has
    // landed and a reload will be answered by it. (A first visit also sees a
    // controllerchange, when its first worker claims it; that is not an update.)
    const startedControlled = !!navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      tookOver = true
      if (startedControlled) void fetchDeployedVersion().then(onNewBuild)
    })
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
      await apply()
    },
    onStatus: (cb: Listener): (() => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
