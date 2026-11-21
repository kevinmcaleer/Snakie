import { describe, expect, it } from 'vitest'
import {
  STARTER_CODE,
  STARTER_KEY,
  hasOpenLink,
  settleStarter,
  shouldOpenStarter,
  starterSettled,
  starterUntouched
} from '../src/renderer/src/store/starter-file'

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v)
  } as unknown as Storage & { data: Map<string, string> }
}

describe('starter file for new users', () => {
  it('opens on a first launch that ends with no tabs', () => {
    expect(shouldOpenStarter({ settled: false, openTabs: 0, openLink: false })).toBe(true)
  })

  it('stays away when files were restored or a shared link is opening', () => {
    expect(shouldOpenStarter({ settled: false, openTabs: 2, openLink: false })).toBe(false)
    expect(shouldOpenStarter({ settled: false, openTabs: 0, openLink: true })).toBe(false)
  })

  it('never returns once settled', () => {
    const storage = memory()
    expect(starterSettled(storage)).toBe(false)
    expect(settleStarter(storage)).toBe(true)
    expect(storage.data.has(STARTER_KEY)).toBe(true)
    expect(starterSettled(storage)).toBe(true)
    expect(shouldOpenStarter({ settled: true, openTabs: 0, openLink: false })).toBe(false)
  })

  it('treats unreadable storage as settled', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(starterSettled(broken)).toBe(true)
    expect(settleStarter(broken)).toBe(false)
  })

  it('counts as untouched only while it is the sole, unedited tab', () => {
    const starter = { name: 'main.py', path: '', dirty: false }
    expect(starterUntouched([starter])).toBe(true)
    expect(starterUntouched([{ ...starter, dirty: true }])).toBe(false)
    expect(starterUntouched([])).toBe(false)
    expect(starterUntouched([starter, { name: 'untitled-2.py', path: '', dirty: false }])).toBe(
      false
    )
    expect(starterUntouched([{ name: 'main.py', path: '/p/main.py', dirty: false }])).toBe(false)
  })

  it('recognises an Open in Snakie link', () => {
    expect(hasOpenLink('?gist=abc&file=main.py', '')).toBe(true)
    expect(hasOpenLink('?repo=o/n&path=a.py', '')).toBe(true)
    expect(hasOpenLink('?name=main.py', '#code=xyz')).toBe(true)
    expect(hasOpenLink('', '#src=xyz')).toBe(true)
    expect(hasOpenLink('', '')).toBe(false)
    expect(hasOpenLink('?utm_source=x', '#section')).toBe(false)
  })

  it('is a program that blinks the onboard LED', () => {
    expect(STARTER_CODE).toContain('Pin("LED", Pin.OUT)')
    expect(STARTER_CODE).toContain('led.toggle()')
    // Something shows in the console too, so Run visibly does something.
    expect(STARTER_CODE).toContain('print(')
    // Comment lines fit a phone's editor.
    for (const line of STARTER_CODE.split('\n').filter((l) => l.startsWith('#'))) {
      expect(line.length, line).toBeLessThanOrEqual(32)
    }
    expect(STARTER_CODE.endsWith('\n')).toBe(true)
  })
})
