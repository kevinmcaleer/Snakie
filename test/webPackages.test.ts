import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WEB_CONNECT_ORIGINS,
  webCanFetch,
  webConnectSrc,
  webFetchRefusal
} from '../src/renderer/src/web/web-hosts'
import { webMipFetch, writeFilesToDevice } from '../src/renderer/src/web/web-install'
import { createWebPackagesApi } from '../src/renderer/src/web/web-packages'
import { MipResolveError } from '../src/shared/mip-resolve'
import { CURATED_PACKAGES } from '../src/shared/packages/registry'

/**
 * THE WEB `packages` BACKEND (#776 follow-on).
 *
 * In the browser `window.api.packages.install` used to fall through to the
 * preload fallback stub and answer `ok: false`, so the Packages tab's Install
 * button did nothing. These cover the three things that had to be true for a
 * real one: the page knows WHERE it may fetch from (and says so when it may
 * not), the files reach the device in an order MicroPython can accept, and a
 * failure in either leg is attributed to the right leg.
 *
 * No DOM and no network: the fetch is stubbed and the device is a parameter.
 */

/** A device that records what an install did to it. */
function fakeDevice(fail?: { onWrite: string }): {
  dirs: string[]
  writes: [string, string][]
  mkdir(p: string): Promise<void>
  writeFile(p: string, c: string): Promise<void>
} {
  const dirs: string[] = []
  const writes: [string, string][] = []
  return {
    dirs,
    writes,
    mkdir: async (p) => {
      dirs.push(p)
    },
    writeFile: async (p, c) => {
      if (fail && p === fail.onWrite) throw new Error('OSError: 28')
      writes.push([p, c])
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('where a web page may fetch from', () => {
  it('allows exactly the origins the CSP lists, and no others', () => {
    for (const origin of WEB_CONNECT_ORIGINS) {
      expect(webCanFetch(`${origin}/some/path.json`)).toBe(true)
    }
    // The directive is built from the same list, so the policy the browser
    // enforces and the check the code makes can never disagree.
    const directive = webConnectSrc()
    expect(directive.startsWith("connect-src 'self' ")).toBe(true)
    expect(directive.split(' ').slice(1)).toEqual(["'self'", ...WEB_CONNECT_ORIGINS])
  })

  it('refuses hosts a page genuinely cannot read', () => {
    // gitlab's raw endpoint sends no CORS header at all, so allowlisting it
    // would only swap a clear refusal for a mystery.
    expect(webCanFetch('https://gitlab.com/o/r/-/raw/HEAD/x.py')).toBe(false)
    expect(webCanFetch('https://example.com/index/package/py/x/latest.json')).toBe(false)
  })

  it('matches an origin exactly — no subdomains, no other scheme or port', () => {
    expect(webCanFetch('https://evil.micropython.org/pi/v2/x')).toBe(false)
    expect(webCanFetch('https://micropython.org.attacker.net/pi/v2/x')).toBe(false)
    expect(webCanFetch('http://micropython.org/pi/v2/x')).toBe(false)
    expect(webCanFetch('https://micropython.org:8443/pi/v2/x')).toBe(false)
  })

  it('is a no for anything that is not a URL', () => {
    expect(webCanFetch('umqtt.simple')).toBe(false)
    expect(webCanFetch('')).toBe(false)
  })

  it('says which host was asked for and where it can be installed instead', () => {
    const why = webFetchRefusal('https://gitlab.com/o/r/-/raw/HEAD/x.py')
    expect(why).toContain('gitlab.com')
    expect(why).toMatch(/desktop app/i)
    expect(why).toContain('raw.githubusercontent.com') // what DOES work
  })
})

describe('the resolver fetch, in a browser', () => {
  it('refuses an unreachable host before any request leaves', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const err = await webMipFetch()('https://gitlab.com/o/r/-/raw/HEAD/x.py').catch((e) => e)
    expect(err).toBeInstanceOf(MipResolveError)
    expect((err as MipResolveError).kind).toBe('unsupported')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lets an allowed host through and returns its text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('print("hi")\n', { status: 200 }))
    )
    const text = await webMipFetch()('https://raw.githubusercontent.com/o/r/HEAD/x.py')
    expect(text).toBe('print("hi")\n')
  })
})

describe('writing a resolved package to the device', () => {
  it('creates every ancestor directory before the files that need it', async () => {
    const device = fakeDevice()
    const out = await writeFilesToDevice(
      'modulino',
      [
        { path: '/lib/modulino/__init__.py', contents: 'a' },
        { path: '/lib/modulino/buttons.py', contents: 'b' }
      ],
      device
    )
    expect(out.ok).toBe(true)
    // MicroPython has no recursive mkdir, so /lib must precede /lib/modulino.
    expect(device.dirs).toEqual(['/lib', '/lib/modulino'])
    expect(device.writes.map(([p]) => p)).toEqual([
      '/lib/modulino/__init__.py',
      '/lib/modulino/buttons.py'
    ])
  })

  it('reports per-file progress, so a 25-file package does not look hung', async () => {
    const steps: string[] = []
    await writeFilesToDevice(
      'pkg',
      [
        { path: '/lib/a.py', contents: 'a' },
        { path: '/lib/b.py', contents: 'b' }
      ],
      fakeDevice(),
      (m) => steps.push(m)
    )
    expect(steps).toHaveLength(2)
    expect(steps[1]).toContain('2/2')
    expect(steps[1]).toContain('/lib/b.py')
  })

  it('tolerates a directory that already exists', async () => {
    const device = fakeDevice()
    device.mkdir = async () => {
      throw new Error('EEXIST')
    }
    const out = await writeFilesToDevice('pkg', [{ path: '/lib/a.py', contents: 'a' }], device)
    expect(out.ok).toBe(true)
  })

  it('blames the BOARD, and names the file it stopped on, when a write fails', async () => {
    const out = await writeFilesToDevice(
      'pkg',
      [
        { path: '/lib/a.py', contents: 'a' },
        { path: '/lib/b.py', contents: 'b' }
      ],
      fakeDevice({ onWrite: '/lib/b.py' })
    )
    expect(out.ok).toBe(false)
    expect(out.log).toContain('/lib/b.py')
    expect(out.log).toMatch(/downloaded to your computer/i)
    expect(out.log).toContain('OSError: 28')
  })

  it('does not claim success when there is nothing to write', async () => {
    const out = await writeFilesToDevice('pkg', [], fakeDevice())
    expect(out.ok).toBe(false)
    expect(out.log).toMatch(/nothing was resolved to write/i)
  })
})

/** Stand in for the browser globals the install path reaches for. */
function stubWindow(device: ReturnType<typeof fakeDevice>): { notified: number } {
  const counter = { notified: 0 }
  vi.stubGlobal('window', {
    api: {
      device,
      modules: {
        notifyChanged: (): void => {
          counter.notified += 1
        }
      }
    }
  })
  return counter
}

describe('the web packages API', () => {
  it('serves the same curated starter list the desktop does, offline', async () => {
    const api = createWebPackagesApi()
    const top = (await (api.topPackages as () => Promise<typeof CURATED_PACKAGES>)()) ?? []
    expect(top).toEqual(CURATED_PACKAGES)
    expect(top.length).toBeGreaterThan(0)
  })

  it('downloads a package here and writes it to the board', async () => {
    const device = fakeDevice()
    const notify = stubWindow(device)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('__version__ = "1.0"\n', { status: 200 }))
    )
    const api = createWebPackagesApi()
    const install = api.install as (
      name: string,
      options?: Record<string, unknown>,
      onProgress?: (p: { state: string; message?: string }) => void
    ) => Promise<{ ok: boolean; log: string; notes: string[] }>
    const res = await install('github:kevinmcaleer/sam/sam.py')
    expect(res.ok).toBe(true)
    expect(device.writes).toEqual([['/lib/sam.py', '__version__ = "1.0"\n']])
    // The user is told where the files came from and where they went.
    expect(res.notes.join(' ')).toMatch(/Downloaded .* into \/lib/)
    // Other surfaces re-probe the board, so an install shows up everywhere.
    expect(notify.notified).toBe(1)
  })

  it('honours an explicit install target', async () => {
    const device = fakeDevice()
    stubWindow(device)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x = 1\n', { status: 200 })))
    const api = createWebPackagesApi()
    const install = api.install as (
      name: string,
      options?: Record<string, unknown>
    ) => Promise<{ ok: boolean }>
    await install('github:o/r/drv.py', { target: '/lib/drivers' })
    expect(device.writes[0][0]).toBe('/lib/drivers/drv.py')
  })

  it('fails a host the browser cannot reach with a reason, not a bare fetch error', async () => {
    const device = fakeDevice()
    stubWindow(device)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch should never have been attempted')
      })
    )
    const api = createWebPackagesApi()
    const install = api.install as (name: string) => Promise<{ ok: boolean; log: string }>
    const res = await install('gitlab:owner/repo/driver.py')
    expect(res.ok).toBe(false)
    expect(res.log).toContain('gitlab.com')
    expect(res.log).toMatch(/desktop app/i)
    // Nothing was downloaded, so it must not read as the board's fault.
    expect(res.log).not.toMatch(/downloaded to your computer/i)
    expect(device.writes).toHaveLength(0)
  })

  it('carries the advanced-option notes the desktop carries', async () => {
    const device = fakeDevice()
    stubWindow(device)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x = 1\n', { status: 200 })))
    const api = createWebPackagesApi()
    const install = api.install as (
      name: string,
      options?: Record<string, unknown>
    ) => Promise<{ ok: boolean; notes: string[] }>
    const res = await install('github:o/r/drv.py', { mpy: true })
    expect(res.notes.join(' ')).toMatch(/mpy conversion is not available/i)
  })
})
