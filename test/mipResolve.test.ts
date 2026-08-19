import { describe, expect, it } from 'vitest'
import {
  MIP_DEFAULT_INDEX,
  MipResolveError,
  deviceDirsFor,
  joinDevicePath,
  resolveMipSpec,
  rewriteMipUrl,
  splitMipRef,
  type MipFetch
} from '../src/shared/mip-resolve'

/**
 * HOST-SIDE `mip` RESOLUTION (#776).
 *
 * A board without `mip` can't install its own drivers, so Snakie resolves the
 * package on the computer and writes the files. That only works if the host
 * agrees with `mip` about what a spec MEANS — where a single file lands, that a
 * repo spec means its `package.json`, that `deps` are transitive. These tests
 * pin those meanings against a fake fetcher, so nothing here touches a network.
 */

/** A fetcher over a fixed URL→body map; records what was asked for. */
function fakeFetch(bodies: Record<string, string>): MipFetch & { asked: string[] } {
  const asked: string[] = []
  const fetchText = async (url: string): Promise<string> => {
    asked.push(url)
    const body = bodies[url]
    if (body === undefined) {
      throw new MipResolveError('not-found', `${url} does not exist (HTTP 404)`, url)
    }
    return body
  }
  return Object.assign(fetchText, { asked })
}

const RAW = 'https://raw.githubusercontent.com'

describe('rewriteMipUrl', () => {
  it("matches mip's own rewrite: owner/repo/path at a branch, HEAD by default", () => {
    expect(rewriteMipUrl('github:stlehmann/micropython-ssd1306/ssd1306.py')).toBe(
      `${RAW}/stlehmann/micropython-ssd1306/HEAD/ssd1306.py`
    )
    expect(rewriteMipUrl('github:owner/repo/pkg/mod.py', 'v1.2')).toBe(
      `${RAW}/owner/repo/v1.2/pkg/mod.py`
    )
  })

  it('rewrites gitlab specs to their raw endpoint', () => {
    expect(rewriteMipUrl('gitlab:owner/repo/mod.py', 'main')).toBe(
      'https://gitlab.com/owner/repo/-/raw/main/mod.py'
    )
  })

  it('passes an http(s) url through untouched', () => {
    const url = 'https://example.com/a/b.py'
    expect(rewriteMipUrl(url, 'v9')).toBe(url)
  })

  it('has no url for an index package NAME — that is what the index is for', () => {
    expect(rewriteMipUrl('umqtt.simple')).toBeNull()
    expect(rewriteMipUrl('github:owner')).toBeNull()
  })
})

describe('splitMipRef', () => {
  it('pins a github/gitlab spec to a tag', () => {
    expect(splitMipRef('github:robert-hh/SH1106/sh1106.py@v1.2')).toEqual({
      spec: 'github:robert-hh/SH1106/sh1106.py',
      ref: 'v1.2'
    })
  })

  it("leaves an http url's @ alone — it is a legal character there", () => {
    const url = 'https://user@example.com/x.py'
    expect(splitMipRef(url)).toEqual({ spec: url })
  })

  it('leaves an unpinned spec unchanged', () => {
    expect(splitMipRef('github:owner/repo')).toEqual({ spec: 'github:owner/repo' })
  })
})

describe('joinDevicePath', () => {
  it('places a package-relative path under the install directory', () => {
    expect(joinDevicePath('/lib', 'modulino/__init__.py')).toBe('/lib/modulino/__init__.py')
    expect(joinDevicePath('/lib/', './mod.py')).toBe('/lib/mod.py')
  })

  it('refuses to escape the install directory', () => {
    // A package.json is remote data. It must never be able to name /boot.py.
    for (const bad of ['../boot.py', '/boot.py', 'a/../../boot.py', '']) {
      expect(() => joinDevicePath('/lib', bad)).toThrow(MipResolveError)
    }
  })
})

describe('deviceDirsFor', () => {
  it('lists every ancestor directory, parents first', () => {
    // MicroPython has no recursive mkdir, so the ORDER is the whole point.
    expect(deviceDirsFor(['/lib/a/b/c.py'])).toEqual(['/lib', '/lib/a', '/lib/a/b'])
  })

  it('never includes the file itself', () => {
    expect(deviceDirsFor(['/lib/mod.py'])).toEqual(['/lib'])
  })

  it('de-duplicates across files while keeping parents before children', () => {
    const dirs = deviceDirsFor(['/lib/pkg/a.py', '/lib/pkg/sub/b.py', '/lib/pkg/c.py'])
    expect(dirs).toEqual(['/lib', '/lib/pkg', '/lib/pkg/sub'])
    for (const dir of dirs) {
      const parent = dir.slice(0, dir.lastIndexOf('/'))
      if (parent) expect(dirs.indexOf(parent)).toBeLessThan(dirs.indexOf(dir))
    }
  })
})

describe('resolveMipSpec — single-file specs', () => {
  it('installs the file at <target>/<basename>, exactly where mip puts it', async () => {
    const fetchText = fakeFetch({
      [`${RAW}/stlehmann/micropython-ssd1306/HEAD/ssd1306.py`]: '# ssd1306'
    })
    const out = await resolveMipSpec('github:stlehmann/micropython-ssd1306/ssd1306.py', {
      fetchText,
      target: '/lib'
    })
    expect(out.files).toEqual([
      {
        path: '/lib/ssd1306.py',
        contents: '# ssd1306',
        url: `${RAW}/stlehmann/micropython-ssd1306/HEAD/ssd1306.py`
      }
    ])
  })

  it('honours a pinned ref', async () => {
    const fetchText = fakeFetch({ [`${RAW}/robert-hh/SH1106/v1.2/sh1106.py`]: '# sh1106' })
    const out = await resolveMipSpec('github:robert-hh/SH1106/sh1106.py@v1.2', { fetchText })
    expect(out.files[0].path).toBe('/lib/sh1106.py')
  })

  it('refuses .mpy bytecode rather than writing corrupt text', async () => {
    // Snakie ships no mpy-cross and fetches as text; a .mpy written that way
    // would be a file that imports as garbage. Fail loudly instead.
    const fetchText = fakeFetch({ [`${RAW}/o/r/HEAD/mod.mpy`]: 'binary' })
    await expect(resolveMipSpec('github:o/r/mod.mpy', { fetchText })).rejects.toMatchObject({
      kind: 'unsupported'
    })
  })
})

describe('resolveMipSpec — package specs with a package.json', () => {
  // The shape of the real Arduino Modulino package (#721): a repo spec whose
  // package.json lists its own files AND declares dependencies. This is the
  // install that fails on a board with no mip, so it is the case that matters.
  const MODULINO_JSON = `${RAW}/arduino/arduino-modulino-mpy/HEAD/package.json`
  const LSM_JSON = `${RAW}/vendor/lsm6dsox/HEAD/package.json`

  const bodies = (): Record<string, string> => ({
    [MODULINO_JSON]: JSON.stringify({
      urls: [
        ['modulino/__init__.py', 'github:arduino/arduino-modulino-mpy/modulino/__init__.py'],
        ['modulino/buttons.py', 'github:arduino/arduino-modulino-mpy/modulino/buttons.py']
      ],
      deps: [['github:vendor/lsm6dsox', '']],
      version: '1.0.0'
    }),
    [`${RAW}/arduino/arduino-modulino-mpy/HEAD/modulino/__init__.py`]: '# modulino init',
    [`${RAW}/arduino/arduino-modulino-mpy/HEAD/modulino/buttons.py`]: '# buttons',
    [LSM_JSON]: JSON.stringify({ urls: [['lsm6dsox.py', 'lsm6dsox.py']] }),
    [`${RAW}/vendor/lsm6dsox/HEAD/lsm6dsox.py`]: '# lsm6dsox'
  })

  it('turns a bare repo spec into its package.json', async () => {
    const fetchText = fakeFetch(bodies())
    await resolveMipSpec('github:arduino/arduino-modulino-mpy', { fetchText })
    expect(fetchText.asked[0]).toBe(MODULINO_JSON)
  })

  it('writes each declared file at the path the package chose, not a flattened name', async () => {
    const fetchText = fakeFetch(bodies())
    const out = await resolveMipSpec('github:arduino/arduino-modulino-mpy', { fetchText })
    const paths = out.files.map((f) => f.path)
    expect(paths).toContain('/lib/modulino/__init__.py')
    expect(paths).toContain('/lib/modulino/buttons.py')
  })

  it('follows deps transitively — a package is not installed until they are', async () => {
    // The Modulino range only works because its deps come too; stopping at the
    // root would install something that imports and then fails at runtime.
    const fetchText = fakeFetch(bodies())
    const out = await resolveMipSpec('github:arduino/arduino-modulino-mpy', { fetchText })
    expect(out.files.map((f) => f.path)).toContain('/lib/lsm6dsox.py')
    expect(out.packages).toContain('github:vendor/lsm6dsox')
  })

  it("resolves a dependency's relative url against its own package.json", async () => {
    const fetchText = fakeFetch(bodies())
    const out = await resolveMipSpec('github:arduino/arduino-modulino-mpy', { fetchText })
    const lsm = out.files.find((f) => f.path === '/lib/lsm6dsox.py')
    expect(lsm?.url).toBe(`${RAW}/vendor/lsm6dsox/HEAD/lsm6dsox.py`)
  })

  it('terminates on a dependency cycle instead of recursing forever', async () => {
    const a = `${RAW}/o/a/HEAD/package.json`
    const b = `${RAW}/o/b/HEAD/package.json`
    const fetchText = fakeFetch({
      [a]: JSON.stringify({ urls: [['a.py', 'a.py']], deps: [['github:o/b', '']] }),
      [b]: JSON.stringify({ urls: [['b.py', 'b.py']], deps: [['github:o/a', '']] }),
      [`${RAW}/o/a/HEAD/a.py`]: '# a',
      [`${RAW}/o/b/HEAD/b.py`]: '# b'
    })
    const out = await resolveMipSpec('github:o/a', { fetchText })
    expect(out.files.map((f) => f.path).sort()).toEqual(['/lib/a.py', '/lib/b.py'])
    expect(fetchText.asked.filter((u) => u === a)).toHaveLength(1)
  })
})

describe('resolveMipSpec — index packages', () => {
  it('asks the index for the SOURCE variant and downloads its content-addressed files', async () => {
    // `py` rather than an .mpy bytecode version: Snakie cannot know the board's
    // bytecode version and ships no mpy-cross.
    const json = `${MIP_DEFAULT_INDEX}/package/py/umqtt.simple/latest.json`
    const fetchText = fakeFetch({
      [json]: JSON.stringify({ hashes: [['umqtt/simple.py', 'abcdef123456']] }),
      [`${MIP_DEFAULT_INDEX}/file/ab/abcdef123456`]: '# simple'
    })
    const out = await resolveMipSpec('umqtt.simple', { fetchText })
    expect(fetchText.asked[0]).toBe(json)
    expect(out.files).toEqual([
      {
        path: '/lib/umqtt/simple.py',
        contents: '# simple',
        url: `${MIP_DEFAULT_INDEX}/file/ab/abcdef123456`
      }
    ])
  })

  it('uses a caller-supplied index for both the description and its files', async () => {
    const index = 'https://example.org/pi/v2'
    const fetchText = fakeFetch({
      [`${index}/package/py/thing/latest.json`]: JSON.stringify({ hashes: [['t.py', 'ffee00']] }),
      [`${index}/file/ff/ffee00`]: '# t'
    })
    const out = await resolveMipSpec('thing', { fetchText, index })
    expect(out.files[0].url.startsWith(index)).toBe(true)
  })
})

describe('resolveMipSpec — failures carry a KIND, never a bare transport error', () => {
  it('reports a missing package description as not-found', async () => {
    const fetchText = fakeFetch({})
    await expect(resolveMipSpec('github:o/r', { fetchText })).rejects.toMatchObject({
      kind: 'not-found'
    })
  })

  it('reports unparseable JSON as malformed', async () => {
    const fetchText = fakeFetch({ [`${RAW}/o/r/HEAD/package.json`]: '<!doctype html>' })
    await expect(resolveMipSpec('github:o/r', { fetchText })).rejects.toMatchObject({
      kind: 'malformed'
    })
  })

  it('reports a package that declares no files rather than "installing" nothing', async () => {
    const fetchText = fakeFetch({ [`${RAW}/o/r/HEAD/package.json`]: '{"version":"1"}' })
    await expect(resolveMipSpec('github:o/r', { fetchText })).rejects.toMatchObject({
      kind: 'malformed'
    })
  })

  it('stops a runaway package at the file guard', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => [`f${i}.py`, `f${i}.py`])
    const bodies: Record<string, string> = {
      [`${RAW}/o/r/HEAD/package.json`]: JSON.stringify({ urls })
    }
    for (let i = 0; i < 10; i++) bodies[`${RAW}/o/r/HEAD/f${i}.py`] = '#'
    await expect(
      resolveMipSpec('github:o/r', { fetchText: fakeFetch(bodies), maxFiles: 3 })
    ).rejects.toMatchObject({ kind: 'too-big' })
  })

  it('stops a runaway dependency chain at the depth guard', async () => {
    const bodies: Record<string, string> = {}
    for (let i = 0; i < 8; i++) {
      bodies[`${RAW}/o/p${i}/HEAD/package.json`] = JSON.stringify({
        urls: [[`p${i}.py`, `p${i}.py`]],
        deps: [[`github:o/p${i + 1}`, '']]
      })
      bodies[`${RAW}/o/p${i}/HEAD/p${i}.py`] = '#'
    }
    await expect(
      resolveMipSpec('github:o/p0', { fetchText: fakeFetch(bodies), maxDepth: 2 })
    ).rejects.toMatchObject({ kind: 'too-big' })
  })
})
