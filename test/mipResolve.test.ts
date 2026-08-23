import { describe, expect, it } from 'vitest'
import {
  MIP_DEFAULT_INDEX,
  MipResolveError,
  deviceDirsFor,
  joinDevicePath,
  normaliseMipTarget,
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
        url: `${RAW}/stlehmann/micropython-ssd1306/HEAD/ssd1306.py`,
        package: 'github:stlehmann/micropython-ssd1306/ssd1306.py'
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

/**
 * WHERE A DEPENDENCY LANDS (#785) — the half that fetching-only tests miss.
 *
 * The block above proves a dependency is FETCHED. That is not the same claim as
 * "it was put somewhere the board can import it", and the difference is the
 * whole bug: `/lib/modulino/lib/vl53l4cd.py` is a downloaded, present,
 * completely unimportable file, because `sys.path` holds `/lib` and nothing
 * below it. The install reports success either way.
 *
 * So these pin the TARGET PATH of a dependency, per file and as a property:
 * every path is `<install target>/<what that file's OWN package declared>`, and
 * a dependency's files are SIBLINGS of the package that pulled them in, never
 * children of it. `MipResolvedFile.package` is what makes that expressible —
 * without knowing whose file a path is, "the dependency is in the right place"
 * cannot be stated at all.
 */
describe('resolveMipSpec — a dependency is a SIBLING of the package that needs it', () => {
  /**
   * The real Arduino Modulino shape (verified against the live package): a
   * package that declares a `lib/` subfolder OF ITS OWN — `modulino/lib/
   * vl53l4cd.py`, imported relatively as `from .lib.vl53l4cd import …` — while
   * separately depending on three packages whose modules are imported BY NAME.
   * The two are easy to confuse, which is precisely why the placement rule has
   * to be pinned rather than eyeballed.
   */
  const MODULINO = 'github:arduino/arduino-modulino-mpy'
  const MODULINO_JSON = `${RAW}/arduino/arduino-modulino-mpy/HEAD/package.json`
  const LTR_JSON = `${RAW}/arduino/micropython-ltr-381rgb-01/main/package.json`
  const HS_JSON = `${RAW}/jposada202020/MicroPython_HS3003/master/package.json`
  const LSM_JSON = `${MIP_DEFAULT_INDEX}/package/py/lsm6dsox/latest.json`

  const bodies = (): Record<string, string> => ({
    [MODULINO_JSON]: JSON.stringify({
      urls: [
        ['modulino/__init__.py', 'github:arduino/modulino-mpy/src/modulino/__init__.py'],
        ['modulino/distance.py', 'github:arduino/modulino-mpy/src/modulino/distance.py'],
        ['modulino/lib/vl53l4cd.py', 'github:arduino/modulino-mpy/src/modulino/lib/vl53l4cd.py']
      ],
      deps: [
        ['lsm6dsox', 'latest'],
        ['github:arduino/micropython-ltr-381rgb-01', 'main'],
        ['github:jposada202020/MicroPython_HS3003', 'master']
      ],
      version: '1.2.0'
    }),
    [`${RAW}/arduino/modulino-mpy/HEAD/src/modulino/__init__.py`]: '# init',
    [`${RAW}/arduino/modulino-mpy/HEAD/src/modulino/distance.py`]: 'from .lib.vl53l4cd import X',
    [`${RAW}/arduino/modulino-mpy/HEAD/src/modulino/lib/vl53l4cd.py`]: '# vl53l4cd',
    // An INDEX dependency: content-addressed `hashes` rather than `urls`.
    [LSM_JSON]: JSON.stringify({ v: 1, version: '1.1.0', hashes: [['lsm6dsox.py', '0203e2eb']] }),
    [`${MIP_DEFAULT_INDEX}/file/02/0203e2eb`]: '# lsm6dsox',
    [LTR_JSON]: JSON.stringify({
      urls: [
        ['ltr381rgb/__init__.py', 'github:arduino/micropython-ltr-381rgb-01/src/ltr381rgb/__init__.py'],
        ['ltr381rgb/device.py', 'github:arduino/micropython-ltr-381rgb-01/src/ltr381rgb/device.py']
      ]
    }),
    [`${RAW}/arduino/micropython-ltr-381rgb-01/main/src/ltr381rgb/__init__.py`]: '# ltr',
    [`${RAW}/arduino/micropython-ltr-381rgb-01/main/src/ltr381rgb/device.py`]: '# ltr device',
    [HS_JSON]: JSON.stringify({
      urls: [
        ['micropython_hs3003/__init__.py', 'github:jposada202020/MicroPython_HS3003/micropython_hs3003/__init__.py'],
        ['micropython_hs3003/hs3003.py', 'github:jposada202020/MicroPython_HS3003/micropython_hs3003/hs3003.py']
      ]
    }),
    [`${RAW}/jposada202020/MicroPython_HS3003/master/micropython_hs3003/__init__.py`]: '# hs',
    [`${RAW}/jposada202020/MicroPython_HS3003/master/micropython_hs3003/hs3003.py`]: '# hs3003'
  })

  it('puts every declared dependency at the install ROOT, not inside the package', async () => {
    // The exact paths four Modulino parts need. `/lib/lsm6dsox.py` is what
    // `from lsm6dsox import LSM6DSOX` resolves to; `/lib/modulino/lsm6dsox.py`
    // is a file the board can never see.
    const out = await resolveMipSpec(MODULINO, { fetchText: fakeFetch(bodies()) })
    const paths = out.files.map((f) => f.path)
    expect(paths).toContain('/lib/lsm6dsox.py')
    expect(paths).toContain('/lib/ltr381rgb/__init__.py')
    expect(paths).toContain('/lib/ltr381rgb/device.py')
    expect(paths).toContain('/lib/micropython_hs3003/__init__.py')
    expect(paths).toContain('/lib/micropython_hs3003/hs3003.py')
  })

  it('installs ALL the declared dependencies, never a subset', async () => {
    // Movement needs lsm6dsox, Light needs ltr381rgb, Thermo needs
    // micropython_hs3003. Two out of three is an install that reports success
    // and then fails at `import` on whichever part drew the short straw.
    const out = await resolveMipSpec(MODULINO, { fetchText: fakeFetch(bodies()) })
    expect(out.packages).toEqual([
      MODULINO,
      'lsm6dsox',
      'github:arduino/micropython-ltr-381rgb-01',
      'github:jposada202020/MicroPython_HS3003'
    ])
    const byPackage = new Set(out.files.map((f) => f.package))
    for (const dep of out.packages.slice(1)) expect(byPackage.has(dep)).toBe(true)
  })

  it('never nests a dependency inside a directory the ROOT package claimed', async () => {
    // The property, stated as a property rather than as five paths: whatever a
    // dependency declares, it may not land under `/lib/modulino`. This is the
    // shape of the bug — a dep's own path joined onto the parent package's
    // directory instead of the install target.
    const out = await resolveMipSpec(MODULINO, { fetchText: fakeFetch(bodies()) })
    const rootDirs = out.files
      .filter((f) => f.package === MODULINO)
      .map((f) => f.path.slice(0, f.path.indexOf('/', out.target.length + 1)))
      .filter((d) => d.length > out.target.length)
    for (const file of out.files) {
      if (file.package === MODULINO) continue
      for (const dir of rootDirs) {
        expect(file.path.startsWith(`${dir}/`)).toBe(false)
      }
    }
  })

  it("keeps a dependency's OWN folder structure, anchored to the target", async () => {
    // A dependency that ships a package directory keeps it — `ltr381rgb/` is
    // the module name the board imports — but relative to `/lib`, not to
    // whatever pulled it in.
    const out = await resolveMipSpec(MODULINO, { fetchText: fakeFetch(bodies()) })
    const ltr = out.files.filter((f) => f.package === 'github:arduino/micropython-ltr-381rgb-01')
    expect(ltr.map((f) => f.path).sort()).toEqual([
      '/lib/ltr381rgb/__init__.py',
      '/lib/ltr381rgb/device.py'
    ])
  })

  it("leaves the package's OWN subfolder alone — it is not a dependency", async () => {
    // `modulino/lib/vl53l4cd.py` is declared by the Modulino package itself and
    // imported relatively (`from .lib.vl53l4cd import …`), so it belongs inside
    // the package. Hoisting it to `/lib/vl53l4cd.py` would break the very
    // import the rest of this rule protects.
    const out = await resolveMipSpec(MODULINO, { fetchText: fakeFetch(bodies()) })
    const vl = out.files.find((f) => f.path.endsWith('vl53l4cd.py'))
    expect(vl?.path).toBe('/lib/modulino/lib/vl53l4cd.py')
    expect(vl?.package).toBe(MODULINO)
  })

  it('anchors a dependency to a CUSTOM target too, not to the package', async () => {
    const out = await resolveMipSpec(MODULINO, { fetchText: fakeFetch(bodies()), target: '/flash/lib' })
    expect(out.target).toBe('/flash/lib')
    expect(out.files.map((f) => f.path)).toContain('/flash/lib/lsm6dsox.py')
    expect(out.files.every((f) => f.path.startsWith('/flash/lib/'))).toBe(true)
  })

  it('resolves a dependency that declares its own lib/ folder against the TARGET', async () => {
    // The adversarial shape, and the one that tells the two bugs apart: a
    // dependency whose declared path STARTS with `lib/`. Joined onto the parent
    // it reads `/lib/pkg/lib/driver.py` — indistinguishable at a glance from a
    // package's legitimate own subfolder, and exactly what was reported on the
    // board. Joined onto the target it is `/lib/lib/driver.py`.
    const fetchText = fakeFetch({
      [`${RAW}/o/pkg/HEAD/package.json`]: JSON.stringify({
        urls: [['pkg/__init__.py', 'github:o/pkg/pkg/__init__.py']],
        deps: [['github:o/dep', '']]
      }),
      [`${RAW}/o/pkg/HEAD/pkg/__init__.py`]: '# pkg',
      [`${RAW}/o/dep/HEAD/package.json`]: JSON.stringify({
        urls: [['lib/driver.py', 'github:o/dep/lib/driver.py']]
      }),
      [`${RAW}/o/dep/HEAD/lib/driver.py`]: '# driver'
    })
    const out = await resolveMipSpec('github:o/pkg', { fetchText })
    const driver = out.files.find((f) => f.package === 'github:o/dep')
    expect(driver?.path).toBe('/lib/lib/driver.py')
    expect(driver?.path).not.toBe('/lib/pkg/lib/driver.py')
  })

  it('attributes each file to the package that DECLARED it', async () => {
    // Provenance is what lets the install log name the dependencies it brought,
    // and what lets every check above say whose file a path is.
    const out = await resolveMipSpec(MODULINO, { fetchText: fakeFetch(bodies()) })
    const owner = (p: string): string | undefined => out.files.find((f) => f.path === p)?.package
    expect(owner('/lib/modulino/__init__.py')).toBe(MODULINO)
    expect(owner('/lib/lsm6dsox.py')).toBe('lsm6dsox')
    expect(owner('/lib/micropython_hs3003/hs3003.py')).toBe(
      'github:jposada202020/MicroPython_HS3003'
    )
  })
})

describe('normaliseMipTarget — an install directory is ABSOLUTE', () => {
  it('anchors a bare folder name, so the paths written match the folders created', () => {
    // `lib` is the placeholder a part author is shown for a mip driver's
    // install folder. Unanchored it produced RELATIVE device paths, while
    // `deviceDirsFor` anchored the same paths when creating their directories —
    // so the folders were made at `/lib` and the files written relative to the
    // board's working directory. They agreed only while that was `/`.
    expect(normaliseMipTarget('lib')).toBe('/lib')
    expect(normaliseMipTarget('/lib')).toBe('/lib')
    expect(normaliseMipTarget('/lib/')).toBe('/lib')
    expect(normaliseMipTarget('./lib')).toBe('/lib')
    expect(normaliseMipTarget('')).toBe('/')
  })

  it('refuses a target that climbs out of the directory it was pointed at', () => {
    expect(() => normaliseMipTarget('lib/../..')).toThrow(MipResolveError)
  })

  it('makes every resolved path absolute even for a relative target', async () => {
    const fetchText = fakeFetch({
      [`${RAW}/o/r/HEAD/package.json`]: JSON.stringify({
        urls: [['pkg/__init__.py', 'github:o/r/pkg/__init__.py']],
        deps: [['github:o/dep', '']]
      }),
      [`${RAW}/o/r/HEAD/pkg/__init__.py`]: '# pkg',
      [`${RAW}/o/dep/HEAD/package.json`]: JSON.stringify({ urls: [['dep.py', 'dep.py']] }),
      [`${RAW}/o/dep/HEAD/dep.py`]: '# dep'
    })
    const out = await resolveMipSpec('github:o/r', { fetchText, target: 'lib' })
    expect(out.target).toBe('/lib')
    expect(out.files.map((f) => f.path).sort()).toEqual(['/lib/dep.py', '/lib/pkg/__init__.py'])
    // The directories the write leg creates now describe the same paths.
    expect(deviceDirsFor(out.files.map((f) => f.path))).toEqual(['/lib', '/lib/pkg'])
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
        url: `${MIP_DEFAULT_INDEX}/file/ab/abcdef123456`,
        package: 'umqtt.simple'
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
