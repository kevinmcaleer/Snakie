import { describe, it, expect } from 'vitest'
import {
  availableToInstall,
  bumpPatch,
  compareVersions,
  diffInstalled,
  githubArchiveUrl,
  isNewer,
  parseRegistry
} from '../src/shared/part-registry'
import type { PartLibrary, PartRegistry } from '../src/shared/part'

describe('compareVersions', () => {
  it('orders by major.minor.patch', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('treats missing components as zero and tolerates a leading v', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('v1.3.0', '1.3.0')).toBe(0)
    expect(compareVersions('1', '1.0.1')).toBe(-1)
  })

  it('ranks a pre-release below the matching release', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
  })

  it('orders numeric pre-release identifiers numerically (rc.2 < rc.10)', () => {
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
    expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBe(1)
    expect(isNewer('1.0.0-rc.10', '1.0.0-rc.9')).toBe(true)
    // numeric identifier sorts below a non-numeric one; shorter run is lower
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  })

  it('ignores +build metadata for ordering', () => {
    expect(compareVersions('1.2.3+build.9', '1.2.3+build.1')).toBe(0)
    expect(compareVersions('1.2.3-rc.1+exp', '1.2.3-rc.1')).toBe(0)
  })

  it('sorts garbage as 0.0.0', () => {
    expect(compareVersions('', '0.0.0')).toBe(0)
    expect(compareVersions('abc', '0.0.1')).toBe(-1)
  })
})

describe('isNewer', () => {
  it('is true when available beats installed', () => {
    expect(isNewer('1.1.0', '1.0.0')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', '1.1.0')).toBe(false)
  })
  it('treats a missing installed version as always-newer', () => {
    expect(isNewer('0.0.1', null)).toBe(true)
    expect(isNewer('1.0.0', '')).toBe(true)
  })
})

describe('bumpPatch', () => {
  it('increments the patch component', () => {
    expect(bumpPatch('1.2.3')).toBe('1.2.4')
    expect(bumpPatch('0.1.0')).toBe('0.1.1')
    expect(bumpPatch('v2.0.9')).toBe('2.0.10')
  })
  it('tolerates short / missing / garbage versions', () => {
    expect(bumpPatch('1.2')).toBe('1.2.1') // missing patch ⇒ 0, then +1
    expect(bumpPatch('2')).toBe('2.0.1') // present major, missing minor/patch ⇒ 0
    expect(bumpPatch('v3')).toBe('3.0.1')
    expect(bumpPatch(undefined)).toBe('0.1.1') // no numeric component ⇒ 0.1.0 → 0.1.1
    expect(bumpPatch('nonsense')).toBe('0.1.1')
  })
  it('drops a pre-release / build suffix before bumping', () => {
    expect(bumpPatch('1.0.0-beta')).toBe('1.0.1')
    expect(bumpPatch('1.0.0+build5')).toBe('1.0.1')
  })
  it('a bumped version is strictly newer than the original', () => {
    expect(isNewer(bumpPatch('1.2.3'), '1.2.3')).toBe(true)
  })
})

describe('parseRegistry', () => {
  it('keeps well-formed entries and drops malformed ones', () => {
    const reg = parseRegistry({
      schema: 1,
      libraries: [
        { id: 'a', name: 'A', repo: 'https://x/a', version: '1.0.0' },
        { id: 'b', name: 'B' }, // no repo → dropped
        { name: 'C', repo: 'https://x/c' }, // no id → dropped
        'nonsense',
        { id: 'd', name: 'D', repo: 'https://x/d' } // no version → defaults
      ]
    })
    expect(reg.schema).toBe(1)
    expect(reg.libraries.map((l) => l.id)).toEqual(['a', 'd'])
    expect(reg.libraries[1].version).toBe('0.0.0')
  })

  it('parses a JSON string and never throws on garbage', () => {
    expect(parseRegistry('{"libraries":[]}').libraries).toEqual([])
    expect(parseRegistry('not json').libraries).toEqual([])
    expect(parseRegistry(null).libraries).toEqual([])
  })
})

describe('diffInstalled / availableToInstall', () => {
  const registry: PartRegistry = {
    libraries: [
      { id: 'pimoroni', name: 'Pimoroni', repo: 'https://x/p', version: '2.0.0' },
      { id: 'adafruit', name: 'Adafruit', repo: 'https://x/a', version: '1.5.0' }
    ]
  }
  const installed: PartLibrary[] = [
    { id: 'pimoroni', name: 'Pimoroni', version: '1.0.0' },
    { id: 'mine', name: 'My Local Lib', version: '0.1.0' }
  ]

  it('flags installed libraries with a newer registry version', () => {
    const updates = diffInstalled(installed, registry)
    expect(updates).toHaveLength(1) // only 'pimoroni' is in both
    expect(updates[0]).toMatchObject({
      id: 'pimoroni',
      installed: '1.0.0',
      available: '2.0.0',
      updateAvailable: true
    })
  })

  it('lists registry entries not yet installed', () => {
    const avail = availableToInstall(installed, registry)
    expect(avail.map((e) => e.id)).toEqual(['adafruit'])
  })
})

describe('githubArchiveUrl', () => {
  it('derives a codeload tar.gz URL from a plain github.com repo URL', () => {
    expect(githubArchiveUrl('https://github.com/adafruit/Adafruit_CircuitPython_BME280')).toBe(
      'https://codeload.github.com/adafruit/Adafruit_CircuitPython_BME280/tar.gz/HEAD'
    )
  })

  it('strips a trailing .git suffix', () => {
    expect(githubArchiveUrl('https://github.com/octocat/Hello-World.git')).toBe(
      'https://codeload.github.com/octocat/Hello-World/tar.gz/HEAD'
    )
  })

  it('tolerates a trailing slash and extra path segments', () => {
    expect(githubArchiveUrl('https://github.com/octocat/Hello-World/')).toBe(
      'https://codeload.github.com/octocat/Hello-World/tar.gz/HEAD'
    )
    expect(githubArchiveUrl('https://github.com/octocat/Hello-World/tree/main')).toBe(
      'https://codeload.github.com/octocat/Hello-World/tar.gz/HEAD'
    )
  })

  it('accepts a www.github.com host', () => {
    expect(githubArchiveUrl('https://www.github.com/octocat/Hello-World')).toBe(
      'https://codeload.github.com/octocat/Hello-World/tar.gz/HEAD'
    )
  })

  it('returns null for non-GitHub hosts', () => {
    expect(githubArchiveUrl('https://gitlab.com/octocat/Hello-World')).toBeNull()
    expect(githubArchiveUrl('https://example.com/octocat/Hello-World')).toBeNull()
  })

  it('returns null for a github.com URL missing an owner or repo', () => {
    expect(githubArchiveUrl('https://github.com/octocat')).toBeNull()
    expect(githubArchiveUrl('https://github.com/')).toBeNull()
  })

  it('returns null for garbage / non-URL input', () => {
    expect(githubArchiveUrl('not a url')).toBeNull()
    expect(githubArchiveUrl('')).toBeNull()
  })
})
