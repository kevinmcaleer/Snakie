import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { planPartSync, planPartStatus, backfillTopLevel } from '../src/shared/bundled-seed'

describe('planPartSync (#166 bundled seed policy)', () => {
  it('copies a part that is not installed', () => {
    expect(planPartSync({ existsLocal: false, bundleHash: 'b' })).toBe('copy-new')
    // A folder that exists but has no readable parts.yml is treated as absent.
    expect(planPartSync({ existsLocal: true, localHash: undefined, bundleHash: 'b' })).toBe('copy-new')
  })

  it('skips a part already identical to the bundle', () => {
    expect(planPartSync({ existsLocal: true, localHash: 'x', bundleHash: 'x', seededHash: 'x' })).toBe('skip')
  })

  it('refreshes a part that is untouched since it was seeded', () => {
    // local still matches what we last wrote (seededHash) but the bundle moved on.
    expect(planPartSync({ existsLocal: true, localHash: 'old', bundleHash: 'new', seededHash: 'old' })).toBe(
      'refresh'
    )
  })

  it('backfills a user-edited part (local differs from both bundle and seed)', () => {
    expect(planPartSync({ existsLocal: true, localHash: 'edited', bundleHash: 'new', seededHash: 'old' })).toBe(
      'backfill'
    )
  })

  it('backfills when there is no manifest record (the first-migration case)', () => {
    // The stuck-XIAO scenario: installed pre-footprint, no seed hash on record →
    // preserve it but add the missing fields, never a blind overwrite.
    expect(planPartSync({ existsLocal: true, localHash: 'stale', bundleHash: 'withFootprint' })).toBe('backfill')
  })
})

describe('backfillTopLevel', () => {
  it('adds a missing top-level field (footprint) and leaves existing ones intact', () => {
    const bundle = 'id: xiao\nname: XIAO\nfootprint: xiao\ndimensions:\n  width: 17.8\n  height: 21\n'
    const local = 'id: xiao\nname: My XIAO\ndimensions:\n  width: 17.8\n  height: 21\n'
    const { text, changed } = backfillTopLevel(bundle, local)
    expect(changed).toBe(true)
    const obj = parse(text)
    expect(obj.footprint).toBe('xiao')
    expect(obj.name).toBe('My XIAO') // the user's edit survives
  })

  it('adds a missing mounts array to a carrier', () => {
    const bundle = 'id: base\nmounts:\n  - id: xiao\n    footprint: xiao\n    x: 0.7\n    y: 0.35\n'
    const local = 'id: base\nname: base\n'
    const { text, changed } = backfillTopLevel(bundle, local)
    expect(changed).toBe(true)
    expect(parse(text).mounts).toEqual([{ id: 'xiao', footprint: 'xiao', x: 0.7, y: 0.35 }])
  })

  it('never overwrites a field the user already set (even a different value)', () => {
    const bundle = 'id: x\nfootprint: xiao\n'
    const local = 'id: x\nfootprint: custom\n'
    const { text, changed } = backfillTopLevel(bundle, local)
    expect(changed).toBe(false)
    expect(text).toBe(local)
  })

  it('is a no-op when the local copy already has every bundle key', () => {
    const bundle = 'id: x\nname: X\n'
    const local = 'id: x\nname: X\nextra: mine\n'
    expect(backfillTopLevel(bundle, local)).toEqual({ text: local, changed: false })
  })
})

describe('planPartStatus (#643 stranded-part visibility)', () => {
  it('reports an untouched, up-to-date install as neither edited nor behind', () => {
    expect(
      planPartStatus({
        localHash: 'x',
        bundleHash: 'x',
        seededHash: 'x',
        localVersion: '0.1.8',
        bundledVersion: '0.1.8'
      })
    ).toEqual({ edited: false, behind: false })
  })

  it('does NOT call an untouched-but-stale part edited (the seeder just refreshes it)', () => {
    // local still matches what we seeded → `refresh`, so there is nothing to warn
    // about; it will adopt the bundle on the next sync by itself.
    expect(
      planPartStatus({
        localHash: 'old',
        bundleHash: 'new',
        seededHash: 'old',
        localVersion: '0.1.5',
        bundledVersion: '0.1.8'
      })
    ).toEqual({ edited: false, behind: true })
  })

  it('flags the real-world stranded part: edited AND behind the bundle', () => {
    // The green-circle case — a hand-edited 0.38.0-era expansion base against a
    // newer bundle. The seeder can only backfill it, so it needs a reset.
    expect(
      planPartStatus({
        localHash: 'edited',
        bundleHash: 'new',
        seededHash: 'old',
        localVersion: '0.1.5',
        bundledVersion: '0.1.8'
      })
    ).toEqual({ edited: true, behind: true })
  })

  it('treats a part with no manifest record as edited (unknown provenance)', () => {
    expect(
      planPartStatus({ localHash: 'stale', bundleHash: 'new', bundledVersion: '0.1.8' })
    ).toEqual({ edited: true, behind: true })
  })

  it('counts an unversioned install as behind any versioned bundle', () => {
    expect(
      planPartStatus({ localHash: 'a', bundleHash: 'b', seededHash: 'a', bundledVersion: '0.1.0' }).behind
    ).toBe(true)
  })

  it('is not behind when the user has bumped past the bundle', () => {
    // Editing a part in the Part Editor bumps its patch version, so an edited copy
    // routinely sits AHEAD of the bundle — that must not nag.
    expect(
      planPartStatus({
        localHash: 'mine',
        bundleHash: 'b',
        seededHash: 'seeded',
        localVersion: '0.2.0',
        bundledVersion: '0.1.8'
      })
    ).toEqual({ edited: true, behind: false })
  })

  it('is never behind when the bundle declares no version', () => {
    expect(planPartStatus({ localHash: 'a', bundleHash: 'b', localVersion: '0.1.0' }).behind).toBe(false)
  })

  it('edited tracks planPartSync exactly — the two must not drift', () => {
    const cases = [
      { localHash: 'x', bundleHash: 'x', seededHash: 'x' },
      { localHash: 'old', bundleHash: 'new', seededHash: 'old' },
      { localHash: 'edited', bundleHash: 'new', seededHash: 'old' },
      { localHash: 'stale', bundleHash: 'new', seededHash: undefined }
    ]
    for (const c of cases) {
      const action = planPartSync({ existsLocal: true, ...c })
      expect(planPartStatus(c).edited).toBe(action === 'backfill')
    }
  })
})
