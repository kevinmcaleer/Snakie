import { describe, expect, it, vi } from 'vitest'
import {
  BundleResolveError,
  bundleInstallOrder,
  bundleReleaseDate,
  circuitPythonMajor,
  libraryArchiveUrl,
  parseBundleIndex,
  parseBundleRelease,
  resolveBundleModule,
  selectBundleMajor,
  type BundleEntry,
  type BundleIndex
} from '../src/shared/circuitpy-bundle'
import { makeZip, testInflate } from './helpers/zip-fixture'

/**
 * THE ADAFRUIT BUNDLE (#758) — CircuitPython's answer to `mip`.
 *
 * CircuitPython has no on-device package manager, so a library install is
 * "download the right archive on the computer, copy the files in". These tests
 * pin the parts of that where being wrong is INVISIBLE until the board fails:
 * that the `.mpy` matches the board's CircuitPython major, that dependencies
 * come too, and that bytecode arrives as bytes rather than mangled text.
 *
 * The shapes below are the real ones — checked against the
 * `adafruit/Adafruit_CircuitPython_Bundle` release `20260820` and the
 * `adafruit_hcsr04` / `adafruit_bus_device` entries of its index. Nothing here
 * touches a network: the fetchers and the decompressor are injected.
 */

/** The real release listing, reduced to the assets the parser reads. */
const RELEASE_JSON = {
  tag_name: '20260820',
  assets: [
    { name: 'adafruit-circuitpython-bundle-10.x-mpy-20260820.zip', browser_download_url: 'u/10' },
    { name: 'adafruit-circuitpython-bundle-20260820.json', browser_download_url: 'u/index' },
    { name: 'adafruit-circuitpython-bundle-9.x-mpy-20260820.zip', browser_download_url: 'u/9' },
    { name: 'adafruit-circuitpython-bundle-examples-20260820.zip', browser_download_url: 'u/ex' },
    { name: 'adafruit-circuitpython-bundle-py-20260820.zip', browser_download_url: 'u/py' },
    { name: 'z-build_tools_version-1.20.1.ignore', browser_download_url: 'u/ignore' }
  ]
}

const entry = (over: Partial<BundleEntry> = {}): BundleEntry => ({
  dependencies: [],
  package: false,
  repo: 'https://github.com/adafruit/adafruit_circuitpython_hcsr04',
  version: '0.4.25',
  pypiName: 'adafruit-circuitpython-hcsr04',
  ...over
})

describe('parseBundleRelease', () => {
  it('learns which CircuitPython majors exist from the asset names', () => {
    // Never hardcoded: Adafruit drops a major from the daily bundle when it goes
    // out of support, and "can I install this on CircuitPython 8?" has to be
    // answered by the release, not by us.
    const release = parseBundleRelease(RELEASE_JSON)
    expect(release.tag).toBe('20260820')
    expect(release.majors).toEqual([9, 10])
    expect(release.indexUrl).toBe('u/index')
  })

  it('does not mistake the examples, source or build-tools assets for a bundle', () => {
    // The same release carries `-examples-`, `-py-` and a `.ignore` marker.
    // Counting any of them as a CircuitPython version would offer a board a
    // bundle that does not exist.
    const release = parseBundleRelease(RELEASE_JSON)
    expect(release.majors.every(Number.isInteger)).toBe(true)
    expect(release.indexUrl).not.toMatch(/u\/(py|ex|ignore)/)
  })

  it('reads the index from the JSON asset, not from a zip that sorts before it', () => {
    // The assets arrive in GitHub's order, with the 10.x zip FIRST. Picking the
    // first asset, or the first one matching `adafruit-circuitpython-bundle-`,
    // would download 17 MB of zip and try to parse it as JSON.
    expect(parseBundleRelease(RELEASE_JSON).indexUrl).toBe('u/index')
  })

  it('refuses a release that carries no index rather than guessing its URL', () => {
    const noIndex = { ...RELEASE_JSON, assets: RELEASE_JSON.assets.filter((a) => a.name.endsWith('.zip')) }
    expect(() => parseBundleRelease(noIndex)).toThrow(BundleResolveError)
  })

  it('refuses an empty or non-release answer', () => {
    for (const bad of [{}, null, { tag_name: '20260820' }]) {
      expect(() => parseBundleRelease(bad)).toThrow(BundleResolveError)
    }
  })
})

describe('bundleReleaseDate', () => {
  it('reads the tag as the build date it is', () => {
    expect(bundleReleaseDate('20260820')).toBe('2026-08-20')
    expect(bundleReleaseDate('weird')).toBe('weird')
  })
})

describe('parseBundleIndex', () => {
  const REAL = JSON.stringify({
    adafruit_hcsr04: {
      dependencies: [],
      external_dependencies: [],
      package: false,
      path: 'lib/adafruit_hcsr04',
      pypi_description: 'CircuitPython library for HC-SR04.',
      pypi_name: 'adafruit-circuitpython-hcsr04',
      repo: 'https://github.com/adafruit/adafruit_circuitpython_hcsr04',
      version: '0.4.25'
    },
    broken: { package: true }
  })

  it('keeps the three fields an archive URL is built from, and drops half-records', () => {
    // A record without repo/version/pypi_name can only fail later, further from
    // the cause — so it never enters the index.
    const index = parseBundleIndex(REAL)
    expect(Object.keys(index)).toEqual(['adafruit_hcsr04'])
    expect(index.adafruit_hcsr04.version).toBe('0.4.25')
    expect(index.adafruit_hcsr04.pypiName).toBe('adafruit-circuitpython-hcsr04')
  })

  it('refuses something that is not the index', () => {
    for (const bad of ['<!doctype html>', '[]', '{}']) {
      expect(() => parseBundleIndex(bad)).toThrow(BundleResolveError)
    }
  })
})

describe('circuitPythonMajor', () => {
  it('reads the major off a CircuitPython board', () => {
    expect(circuitPythonMajor({ dialect: 'circuitpython', version: '10.2.1' })).toBe(10)
    expect(circuitPythonMajor({ dialect: 'circuitpython', version: '9.0.0-beta.2' })).toBe(9)
  })

  it('has no answer for a MicroPython board — the bundle is not for it', () => {
    expect(circuitPythonMajor({ dialect: 'micropython', version: '1.28.0' })).toBeNull()
    expect(circuitPythonMajor(null)).toBeNull()
  })

  it('refuses to invent a major from a version that is not a number (#776)', () => {
    // Vendor builds report a BRANCH NAME as their version. `parseInt` would turn
    // 'feature/psram-and-wifi' into nothing useful and 'v9-dev' into 9.
    expect(circuitPythonMajor({ dialect: 'circuitpython', version: 'feature/psram' })).toBeNull()
    expect(circuitPythonMajor({ dialect: 'circuitpython' })).toBeNull()
  })
})

describe('selectBundleMajor', () => {
  const release = parseBundleRelease(RELEASE_JSON)

  it('matches the board exactly', () => {
    expect(selectBundleMajor(release, 9)).toBe(9)
    expect(selectBundleMajor(release, 10)).toBe(10)
  })

  it('has no nearest match — a 9.x .mpy on an 8.x board simply does not import', () => {
    expect(() => selectBundleMajor(release, 8)).toThrow(BundleResolveError)
    expect(() => selectBundleMajor(release, 11)).toThrow(BundleResolveError)
  })

  it('names BOTH sides when it refuses, so the user knows what to change', () => {
    try {
      selectBundleMajor(release, 8)
      expect.unreachable()
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain('2026-08-20')
      expect(message).toContain('9 and 10')
      expect(message).toContain('CircuitPython 8')
      expect((err as BundleResolveError).kind).toBe('unsupported')
    }
  })

  it('refuses when the board never said what it runs', () => {
    expect(() => selectBundleMajor(release, null)).toThrow(BundleResolveError)
  })
})

describe('bundleInstallOrder', () => {
  // The real dependency shape: adafruit_mpu6050 needs bus_device and register,
  // and register itself needs bus_device.
  const index: BundleIndex = {
    adafruit_mpu6050: entry({ dependencies: ['adafruit_bus_device', 'adafruit_register'] }),
    adafruit_register: entry({ dependencies: ['adafruit_bus_device'], package: true }),
    adafruit_bus_device: entry({ package: true })
  }

  it('puts every dependency before the library that imports it', () => {
    const order = bundleInstallOrder(index, 'adafruit_mpu6050')
    expect(order).toContain('adafruit_bus_device')
    for (const [dependent, dep] of [
      ['adafruit_mpu6050', 'adafruit_register'],
      ['adafruit_register', 'adafruit_bus_device']
    ]) {
      expect(order.indexOf(dep)).toBeLessThan(order.indexOf(dependent))
    }
  })

  it('names a shared dependency once', () => {
    const order = bundleInstallOrder(index, 'adafruit_mpu6050')
    expect(order.filter((m) => m === 'adafruit_bus_device')).toHaveLength(1)
  })

  it('terminates on a dependency cycle instead of recursing for ever', () => {
    const cyclic: BundleIndex = {
      a: entry({ dependencies: ['b'] }),
      b: entry({ dependencies: ['a'] })
    }
    expect(bundleInstallOrder(cyclic, 'a').sort()).toEqual(['a', 'b'])
  })

  it('refuses a missing dependency rather than installing a library that cannot import', () => {
    const broken: BundleIndex = { a: entry({ dependencies: ['nope'] }) }
    try {
      bundleInstallOrder(broken, 'a')
      expect.unreachable()
    } catch (err) {
      expect((err as BundleResolveError).kind).toBe('not-found')
      expect((err as Error).message).toContain('a needs nope')
    }
  })

  it('stops a runaway dependency set at the guard', () => {
    const deep: BundleIndex = {}
    for (let i = 0; i < 12; i++) deep[`p${i}`] = entry({ dependencies: [`p${i + 1}`] })
    deep.p12 = entry()
    expect(() => bundleInstallOrder(deep, 'p0', 3)).toThrow(/more than 3/)
  })
})

describe('libraryArchiveUrl', () => {
  it("builds the library's own release asset from the index, nothing guessed", () => {
    // Verified against the real asset:
    // .../adafruit_circuitpython_hcsr04/releases/download/0.4.25/
    //   adafruit-circuitpython-hcsr04-9.x-mpy-0.4.25.zip
    expect(libraryArchiveUrl(entry(), 9)).toBe(
      'https://github.com/adafruit/adafruit_circuitpython_hcsr04/releases/download/0.4.25/' +
        'adafruit-circuitpython-hcsr04-9.x-mpy-0.4.25.zip'
    )
  })

  it('changes with the board major, which is the point of it', () => {
    expect(libraryArchiveUrl(entry(), 10)).toContain('-10.x-mpy-')
    expect(libraryArchiveUrl(entry(), 9)).toContain('-9.x-mpy-')
  })
})

describe('resolveBundleModule', () => {
  /** The layout a real per-library archive has: `<stem>/lib/…` beside the rest. */
  function libraryZip(stem: string, files: Record<string, Uint8Array>): Uint8Array {
    return makeZip([
      { name: `${stem}/examples/demo.py`, bytes: new TextEncoder().encode('# demo') },
      { name: `${stem}/requirements/pyproject.toml`, bytes: new TextEncoder().encode('[x]') },
      ...Object.entries(files).map(([name, bytes]) => ({ name: `${stem}/lib/${name}`, bytes }))
    ])
  }

  /** Bytes that are NOT valid UTF-8 — real `.mpy` starts `M` + a format byte. */
  const MPY = new Uint8Array([0x4d, 0x06, 0x00, 0x1f, 0xff, 0xfe, 0x80, 0xc3, 0x28])

  const HCSR04 = entry()
  const BUS = entry({
    package: true,
    repo: 'https://github.com/adafruit/adafruit_circuitpython_busdevice',
    version: '5.2.17',
    pypiName: 'adafruit-circuitpython-busdevice'
  })

  /** A fetcher over a fixed URL→archive map; records what it was asked for. */
  function fakeFetch(archives: Record<string, Uint8Array>): {
    (url: string): Promise<Uint8Array>
    asked: string[]
  } {
    const asked: string[] = []
    const fn = async (url: string): Promise<Uint8Array> => {
      asked.push(url)
      const zip = archives[url]
      if (!zip) throw new BundleResolveError('not-found', `${url} does not exist (HTTP 404)`, url)
      return zip
    }
    return Object.assign(fn, { asked })
  }

  it('installs a single-file library as one .mpy in /lib, byte for byte', async () => {
    const url = libraryArchiveUrl(HCSR04, 9)
    const fetchBinary = fakeFetch({
      [url]: libraryZip('adafruit-circuitpython-hcsr04-9.x-mpy-0.4.25', {
        'adafruit_hcsr04.mpy': MPY
      })
    })
    const out = await resolveBundleModule('adafruit_hcsr04', {
      index: { adafruit_hcsr04: HCSR04 },
      major: 9,
      fetchBinary,
      inflate: testInflate
    })
    expect(out.files).toHaveLength(1)
    expect(out.files[0].path).toBe('/lib/adafruit_hcsr04.mpy')
    // The bytes must be IDENTICAL. Anything that decoded them as text would
    // replace 0xff/0x80 with U+FFFD and leave a file that imports as garbage.
    expect(Array.from(out.files[0].bytes)).toEqual(Array.from(MPY))
  })

  it('keeps a package library as a FOLDER, not a flattened name', async () => {
    const url = libraryArchiveUrl(BUS, 9)
    const fetchBinary = fakeFetch({
      [url]: libraryZip('adafruit-circuitpython-busdevice-9.x-mpy-5.2.17', {
        'adafruit_bus_device/i2c_device.mpy': MPY,
        'adafruit_bus_device/spi_device.mpy': MPY,
        'adafruit_bus_device/__init__.py': new Uint8Array()
      })
    })
    const out = await resolveBundleModule('adafruit_bus_device', {
      index: { adafruit_bus_device: BUS },
      major: 9,
      fetchBinary,
      inflate: testInflate
    })
    expect(out.files.map((f) => f.path).sort()).toEqual([
      '/lib/adafruit_bus_device/__init__.py',
      '/lib/adafruit_bus_device/i2c_device.mpy',
      '/lib/adafruit_bus_device/spi_device.mpy'
    ])
  })

  it('takes only lib/ — examples and packaging metadata are not device code', async () => {
    const url = libraryArchiveUrl(HCSR04, 9)
    const fetchBinary = fakeFetch({
      [url]: libraryZip('stem', { 'adafruit_hcsr04.mpy': MPY })
    })
    const out = await resolveBundleModule('adafruit_hcsr04', {
      index: { adafruit_hcsr04: HCSR04 },
      major: 9,
      fetchBinary,
      inflate: testInflate
    })
    expect(out.files.map((f) => f.path)).toEqual(['/lib/adafruit_hcsr04.mpy'])
  })

  it('installs dependencies too — the library alone would import and then fail', async () => {
    const mpu = entry({
      dependencies: ['adafruit_bus_device'],
      repo: 'https://github.com/adafruit/adafruit_circuitpython_mpu6050',
      version: '1.3.8',
      pypiName: 'adafruit-circuitpython-mpu6050'
    })
    const fetchBinary = fakeFetch({
      [libraryArchiveUrl(mpu, 10)]: libraryZip('mpu', { 'adafruit_mpu6050.mpy': MPY }),
      [libraryArchiveUrl(BUS, 10)]: libraryZip('bus', { 'adafruit_bus_device/__init__.py': MPY })
    })
    const out = await resolveBundleModule('adafruit_mpu6050', {
      index: { adafruit_mpu6050: mpu, adafruit_bus_device: BUS },
      major: 10,
      fetchBinary,
      inflate: testInflate
    })
    expect(out.modules).toEqual(['adafruit_bus_device', 'adafruit_mpu6050'])
    expect(out.files.map((f) => f.path)).toContain('/lib/adafruit_bus_device/__init__.py')
    // Every archive fetched is the 10.x one, because the board is 10.x.
    expect(fetchBinary.asked.every((u) => u.includes('-10.x-mpy-'))).toBe(true)
  })

  it('reports the major it resolved for, so the note cannot claim a different one', async () => {
    const fetchBinary = fakeFetch({
      [libraryArchiveUrl(HCSR04, 10)]: libraryZip('s', { 'adafruit_hcsr04.mpy': MPY })
    })
    const out = await resolveBundleModule('adafruit_hcsr04', {
      index: { adafruit_hcsr04: HCSR04 },
      major: 10,
      fetchBinary,
      inflate: testInflate
    })
    expect(out.major).toBe(10)
  })

  it('never lets an archive write outside the install directory', async () => {
    // The archive is remote data. A `..` in a member name must not reach /boot.py.
    const url = libraryArchiveUrl(HCSR04, 9)
    const fetchBinary = fakeFetch({
      [url]: makeZip([{ name: 'stem/lib/../../boot.py', bytes: MPY }])
    })
    await expect(
      resolveBundleModule('adafruit_hcsr04', {
        index: { adafruit_hcsr04: HCSR04 },
        major: 9,
        fetchBinary,
        inflate: testInflate
      })
    ).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('reports a missing archive as not-found, carrying the URL it asked for', async () => {
    const fetchBinary = fakeFetch({})
    try {
      await resolveBundleModule('adafruit_hcsr04', {
        index: { adafruit_hcsr04: HCSR04 },
        major: 9,
        fetchBinary,
        inflate: testInflate
      })
      expect.unreachable()
    } catch (err) {
      expect((err as BundleResolveError).kind).toBe('not-found')
      expect((err as Error).message).toContain('-9.x-mpy-')
    }
  })

  it('reports an archive it cannot read as malformed, not as a crash', async () => {
    const url = libraryArchiveUrl(HCSR04, 9)
    const fetchBinary = fakeFetch({ [url]: new TextEncoder().encode('rate limit exceeded') })
    await expect(
      resolveBundleModule('adafruit_hcsr04', {
        index: { adafruit_hcsr04: HCSR04 },
        major: 9,
        fetchBinary,
        inflate: testInflate
      })
    ).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('refuses an archive with no library in it', async () => {
    const url = libraryArchiveUrl(HCSR04, 9)
    const fetchBinary = fakeFetch({
      [url]: makeZip([{ name: 'stem/examples/demo.py', bytes: MPY }])
    })
    await expect(
      resolveBundleModule('adafruit_hcsr04', {
        index: { adafruit_hcsr04: HCSR04 },
        major: 9,
        fetchBinary,
        inflate: testInflate
      })
    ).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('stops a runaway library at the file guard', async () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 10; i++) files[`pkg/f${i}.mpy`] = MPY
    const fetchBinary = fakeFetch({ [libraryArchiveUrl(HCSR04, 9)]: libraryZip('s', files) })
    await expect(
      resolveBundleModule('adafruit_hcsr04', {
        index: { adafruit_hcsr04: HCSR04 },
        major: 9,
        fetchBinary,
        inflate: testInflate,
        maxFiles: 3
      })
    ).rejects.toMatchObject({ kind: 'too-big' })
  })

  it('downloads a shared dependency once, however many libraries want it', async () => {
    const a = entry({ dependencies: ['adafruit_bus_device'], pypiName: 'a', version: '1' })
    const b = entry({ dependencies: ['adafruit_bus_device'], pypiName: 'b', version: '1' })
    const root = entry({ dependencies: ['a', 'b'], pypiName: 'root', version: '1' })
    const fetchBinary = fakeFetch({
      [libraryArchiveUrl(root, 9)]: libraryZip('r', { 'root.mpy': MPY }),
      [libraryArchiveUrl(a, 9)]: libraryZip('a', { 'a.mpy': MPY }),
      [libraryArchiveUrl(b, 9)]: libraryZip('b', { 'b.mpy': MPY }),
      [libraryArchiveUrl(BUS, 9)]: libraryZip('bus', { 'adafruit_bus_device/__init__.py': MPY })
    })
    await resolveBundleModule('root', {
      index: { root, a, b, adafruit_bus_device: BUS },
      major: 9,
      fetchBinary,
      inflate: testInflate
    })
    const busUrl = libraryArchiveUrl(BUS, 9)
    expect(fetchBinary.asked.filter((u) => u === busUrl)).toHaveLength(1)
  })

  it('does not decompress the parts of an archive it will not install', async () => {
    const inflate = vi.fn(testInflate)
    const fetchBinary = fakeFetch({
      [libraryArchiveUrl(HCSR04, 9)]: libraryZip('s', { 'adafruit_hcsr04.mpy': MPY })
    })
    await resolveBundleModule('adafruit_hcsr04', {
      index: { adafruit_hcsr04: HCSR04 },
      major: 9,
      fetchBinary,
      inflate
    })
    // One lib file; examples/ and requirements/ never expanded.
    expect(inflate).toHaveBeenCalledTimes(1)
  })
})
