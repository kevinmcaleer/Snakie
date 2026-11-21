import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  fetchDeployedVersion,
  isDifferentBuild,
  reloadPlan,
  TAKEOVER_WAIT_MS,
  POLL_INTERVAL_MS,
  SW_SCOPE,
  SW_URL,
  VERSION_URL
} from '../src/renderer/src/web/web-updates'
import { hasUnsavedWork, setUnsavedWorkProbe } from '../src/renderer/src/lib/unsaved-work'

/**
 * The browser build picks up a new deploy (#971).
 *
 * app.snakie.org kept serving an older build until you hard-reloaded. Not HTTP
 * caching — the service worker (#464). `registerType: 'autoUpdate'` was silently
 * inert, because vite-plugin-pwa only honours it when `injectRegister` is
 * `'auto'` or absent:
 *
 *   // vite-plugin-pwa/dist/index.js
 *   if ((injectRegister === "auto" || injectRegister == null) && registerType === "autoUpdate") {
 *     workbox.skipWaiting = true
 *     workbox.clientsClaim = true
 *   }
 *
 * We set `'script'`, so Workbox shipped a worker that only calls `skipWaiting()`
 * on a `SKIP_WAITING` message — which nothing sent — and never calls
 * `clients.claim()`. A deploy installed, then waited for every tab of the origin
 * to close, while navigations kept being served the OLD precached `index.html`.
 */

const webConfigRaw = readFileSync('vite.web.config.ts', 'utf8')
/** Comments here QUOTE the setting they warn about, so match on code only. */
const webConfig = webConfigRaw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
const notifier = readFileSync('src/renderer/src/components/UpdateNotifier.tsx', 'utf8')

describe('the service worker is configured to actually take over', () => {
  it('sets skipWaiting AND clientsClaim explicitly, not by inference', () => {
    // Explicitly, because the inference is what failed: the config *said*
    // autoUpdate and the build disagreed, with no warning. Stating both here
    // means the behaviour cannot depend on a plugin internal again.
    expect(webConfig).toMatch(/^\s*skipWaiting: true,$/m)
    expect(webConfig).toMatch(/^\s*clientsClaim: true,$/m)
  })

  it('never sets injectRegister to the value that disables autoUpdate', () => {
    // 'script' is the exact value that silently switched autoUpdate off. It was
    // chosen so the registration was not an inline script the strict CSP
    // rejects — our own bundle is `'self'`, so registering from app code keeps
    // that property without the side effect.
    const setting = /injectRegister:\s*([^,\n]+)/.exec(webConfig)?.[1]?.trim()
    expect(setting, 'injectRegister should be null — we register from app code').toBe('null')
  })

  it('registers the worker itself, since the plugin no longer injects one', () => {
    // With injectRegister null nothing emits registerSW.js. If this registration
    // ever went away the PWA would silently stop existing: no offline, no
    // updates, and no error either.
    const updates = readFileSync('src/renderer/src/web/web-updates.ts', 'utf8')
    expect(updates).toContain('navigator.serviceWorker')
    expect(updates).toMatch(/\.register\(\s*SW_URL/)
    const install = readFileSync('src/renderer/src/web/install-web-api.ts', 'utf8')
    expect(install).toContain('createWebUpdatesApi')
  })

  it('points at the worker the plugin generates, at the whole origin', () => {
    expect(SW_URL).toBe('/sw.js')
    expect(SW_SCOPE).toBe('/')
  })
})

describe('the version stamp is emitted and always fetched fresh', () => {
  it('writes version.json next to the bundle', () => {
    expect(webConfig).toContain("fileName: 'version.json'")
    expect(webConfig).toContain('version: pkgVersion')
  })

  it('leaves it OUT of the precache, or the check would answer itself', () => {
    // A staleness check served from the cache reports "up to date" forever.
    const glob = /globPatterns:\s*\[([^\]]*)\]/.exec(webConfig)?.[1] ?? ''
    expect(glob).not.toContain('json')
  })

  it('asks for it with no-store', async () => {
    let seen: RequestInit | undefined
    const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init
      return { ok: true, json: async () => ({ version: '9.9.9' }) } as unknown as Response
    }) as unknown as typeof fetch

    await fetchDeployedVersion(fake, VERSION_URL)
    expect(seen?.cache).toBe('no-store')
  })

  it('reads the deployed version out of it', async () => {
    const fake = (async () =>
      ({
        ok: true,
        json: async () => ({ version: '0.57.0' })
      }) as unknown as Response) as typeof fetch
    await expect(fetchDeployedVersion(fake)).resolves.toBe('0.57.0')
  })

  it('treats every failure as "I do not know", never as an update', async () => {
    const notFound = (async () => ({ ok: false }) as unknown as Response) as typeof fetch
    const garbage = (async () =>
      ({
        ok: true,
        json: async () => ({ nope: 1 })
      }) as unknown as Response) as typeof fetch
    const offline = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    await expect(fetchDeployedVersion(notFound)).resolves.toBeUndefined()
    await expect(fetchDeployedVersion(garbage)).resolves.toBeUndefined()
    await expect(fetchDeployedVersion(offline)).resolves.toBeUndefined()
  })
})

describe('deciding whether the server is serving something else', () => {
  it('is a difference, not an ordering — a rollback must reach people too', () => {
    expect(isDifferentBuild('0.55.0', '0.56.0')).toBe(true)
    expect(isDifferentBuild('0.56.0', '0.55.0')).toBe(true)
  })

  it('says no when they match', () => {
    expect(isDifferentBuild('0.56.0', '0.56.0')).toBe(false)
  })

  it('says no when either side is unknown', () => {
    expect(isDifferentBuild('0.56.0', undefined)).toBe(false)
    expect(isDifferentBuild('', '0.56.0')).toBe(false)
  })

  it('polls on a human timescale, not a busy one', () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000)
  })
})

describe('a reload never discards unsaved work', () => {
  it('assumes there IS unsaved work until the UI says otherwise', () => {
    // Before the app mounts nobody can answer, and the costs are asymmetric: a
    // needless prompt is an annoyance, a discarded buffer is not.
    expect(hasUnsavedWork()).toBe(true)
  })

  it('answers from the registered probe', () => {
    let dirty = false
    const off = setUnsavedWorkProbe(() => dirty)
    expect(hasUnsavedWork()).toBe(false)
    dirty = true
    expect(hasUnsavedWork()).toBe(true)
    off()
  })

  it('goes back to assuming the worst once unregistered', () => {
    const off = setUnsavedWorkProbe(() => false)
    expect(hasUnsavedWork()).toBe(false)
    off()
    expect(hasUnsavedWork()).toBe(true)
  })

  it('does not let a stale unregister clobber a newer probe', () => {
    const offOld = setUnsavedWorkProbe(() => false)
    setUnsavedWorkProbe(() => true)
    offOld() // the old component unmounting must not remove the new probe
    expect(hasUnsavedWork()).toBe(true)
    setUnsavedWorkProbe(() => false)() // reset
  })

  it('is what the updater consults before reloading', () => {
    const updates = readFileSync('src/renderer/src/web/web-updates.ts', 'utf8')
    expect(updates).toContain('hasUnsavedWork()')
    // and the UI is what supplies the answer
    expect(notifier).toContain('setUnsavedWorkProbe')
    expect(notifier).toContain('f.dirty')
  })
})

describe('the notice says what a browser can actually do', () => {
  it('offers Reload on the web and Restart on the desktop', () => {
    // Same 'downloaded' lifecycle state, two different acts: the desktop
    // relaunches into an installer, the web build reloads. Telling a browser
    // user to "restart" sends them looking for a menu item that isn't there.
    expect(notifier).toContain("isWeb ? 'Reload' : 'Restart'")
    expect(notifier).toContain('reload to update')
    expect(notifier).toContain('restart to update')
  })
})

describe('reloading into a new build waits for the new worker', () => {
  // 2026-11-21: the reload used to fire the moment a new worker reached
  // `installed`. The navigation then went to the OLD worker as skipWaiting shut
  // it down, was cut off ("Failed to fetch" in sw.js), and the tab froze.
  const updates = readFileSync('src/renderer/src/web/web-updates.ts', 'utf8')
  const code = updates.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

  it('waits while a new worker is still on its way', () => {
    expect(reloadPlan({ registered: true, tookOver: false, newWorkerPending: true })).toBe('wait')
    // even after an earlier deploy took over: a later one may be behind it
    expect(reloadPlan({ registered: true, tookOver: true, newWorkerPending: true })).toBe('wait')
  })

  it('reloads once the new worker is in charge, or with no worker at all', () => {
    expect(reloadPlan({ registered: true, tookOver: true, newWorkerPending: false })).toBe('reload')
    expect(reloadPlan({ registered: false, tookOver: false, newWorkerPending: false })).toBe(
      'reload'
    )
  })

  it('goes around the old worker when no new one is coming (a failed install)', () => {
    // Otherwise the old worker answers the reload with the old build again.
    expect(reloadPlan({ registered: true, tookOver: false, newWorkerPending: false })).toBe(
      'bypass'
    )
    expect(code).toMatch(/\.unregister\(\)[\s\S]*window\.location\.reload\(\)/)
    expect(code).toMatch(/worker\.state === 'redundant'/)
  })

  it('treats controllerchange, not `installed`, as the update having landed', () => {
    expect(code).toMatch(/addEventListener\('controllerchange'/)
    expect(code).not.toMatch(/state === 'installed'/)
  })

  it('gives a slow worker a while, not forever', () => {
    expect(TAKEOVER_WAIT_MS).toBeGreaterThanOrEqual(5_000)
    expect(TAKEOVER_WAIT_MS).toBeLessThanOrEqual(60_000)
  })
})
