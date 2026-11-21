// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  NAME_PATTERN,
  NOTES,
  blocks,
  byDay,
  dayLabel,
  parseNote,
  spans
} from '../src/renderer/src/whatsnew/notes'
import { loadSeen, saveSeen, unseenIds, SEEN_KEY } from '../src/renderer/src/whatsnew/seen'
import { useWhatsNew, openWhatsNew } from '../src/renderer/src/whatsnew/useWhatsNew'
import { WhatsNewCard, WhatsNewDialog } from '../src/renderer/src/whatsnew/WhatsNew'

/**
 * What's new (modelled on BetterCAD's): the note files follow the format, the
 * card shows once after an update, and the list can always be opened again.
 */
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DIR = join(__dirname, '../src/renderer/src/whatsnew/notes')
const files = readdirSync(DIR).filter((f) => !f.startsWith('.'))

describe('release note files', () => {
  it.each(files)('%s follows the format', (file) => {
    expect(file, 'name it YYYY-MM-DD-short-name.md').toMatch(/\.md$/)
    const id = file.replace(/\.md$/, '')
    expect(id, 'name it YYYY-MM-DD-short-name.md, lower case').toMatch(NAME_PATTERN)
    const note = parseNote(id, readFileSync(join(DIR, file), 'utf8'))
    expect(note, "start with a '# Feature name' line").not.toBeNull()
    const { title, body, date } = note!
    expect(Number.isNaN(Date.parse(date)), 'a real date').toBe(false)
    expect(title.length, 'a short feature name, 60 characters at most').toBeLessThanOrEqual(60)
    expect(title, 'sentence case: start with a capital').toMatch(/^[A-Z0-9"]/)
    expect(title, 'no full stop on the name').not.toMatch(/\.$/)
    expect(body.length, 'a sentence or two under the name').toBeGreaterThan(0)
    expect(body.length, 'keep it short: 400 characters at most').toBeLessThanOrEqual(400)
    expect(title + body, 'plain words, no issue numbers').not.toMatch(/#\d/)
  })

  it('loads every file, newest first', () => {
    expect(NOTES.length).toBe(files.length)
    const ids = NOTES.map((n) => n.id)
    expect(ids).toEqual([...ids].sort().reverse())
  })
})

describe('notes helpers', () => {
  it('parseNote reads the name and body, and refuses a bad file', () => {
    expect(parseNote('2026-11-21-blink', '# Blink faster\n\nIt blinks.\n')).toEqual({
      id: '2026-11-21-blink',
      date: '2026-11-21',
      title: 'Blink faster',
      body: 'It blinks.'
    })
    expect(parseNote('2026-11-21-blink', 'No heading.')).toBeNull()
    expect(parseNote('blink', '# Blink\nBody')).toBeNull()
  })

  it('blocks splits paragraphs and lists', () => {
    expect(blocks('One line\nruns on.\n\n- First\n- Second\n  more')).toEqual([
      { kind: 'p', text: 'One line runs on.' },
      { kind: 'ul', items: ['First', 'Second more'] }
    ])
  })

  it('spans finds bold and code', () => {
    expect(spans('Press **Run** or type `import`.')).toEqual([
      { kind: 'text', text: 'Press ' },
      { kind: 'strong', text: 'Run' },
      { kind: 'text', text: ' or type ' },
      { kind: 'code', text: 'import' },
      { kind: 'text', text: '.' }
    ])
  })

  it('byDay groups by date and dayLabel reads the same everywhere', () => {
    const days = byDay([
      { id: '2026-11-21-b', date: '2026-11-21', title: 'B', body: 'b' },
      { id: '2026-11-21-a', date: '2026-11-21', title: 'A', body: 'a' },
      { id: '2026-11-20-c', date: '2026-11-20', title: 'C', body: 'c' }
    ])
    expect(days.map((d) => [d.date, d.notes.length])).toEqual([
      ['2026-11-21', 2],
      ['2026-11-20', 1]
    ])
    expect(dayLabel('2026-11-21')).toBe('21 November 2026')
  })

  it('a first visit has nothing new; later visits get what they have not seen', () => {
    expect(unseenIds(['a', 'b'], null)).toEqual([])
    expect(unseenIds(['a', 'b'], new Set(['b']))).toEqual(['a'])
  })
})

describe('What’s new UI', () => {
  let host: HTMLElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  const button = (text: string): HTMLButtonElement => {
    const b = [...host.querySelectorAll('button')].find(
      (el) => el.textContent?.includes(text) || el.getAttribute('aria-label')?.includes(text)
    )
    if (!b) throw new Error(`no button "${text}"`)
    return b
  }

  it('the card names up to three new features and counts the rest', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    const fresh = NOTES.slice(0, 5).map((n) => n.id)
    act(() => root.render(<WhatsNewCard fresh={fresh} onOpen={onOpen} onDismiss={onDismiss} />))
    const card = host.querySelector('aside[aria-label="What\'s new"]')
    expect(card?.textContent).toContain(NOTES[0].title)
    expect(card?.textContent).toContain('and 2 more')
    act(() => button('See what').click())
    expect(onOpen).toHaveBeenCalled()
    act(() => button('Dismiss').click())
    expect(onDismiss).toHaveBeenCalled()
  })

  it('the list shows every note and marks only the new ones', () => {
    act(() => root.render(<WhatsNewDialog fresh={[NOTES[0].id]} onClose={() => undefined} />))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelectorAll('article')).toHaveLength(NOTES.length)
    expect(host.querySelectorAll('.whatsnew-new')).toHaveLength(1)
  })

  function Probe({ onState }: { onState: (s: ReturnType<typeof useWhatsNew>) => void }): null {
    onState(useWhatsNew(10))
    return null
  }

  const mount = async (): Promise<{ current: ReturnType<typeof useWhatsNew> }> => {
    const ref = {} as { current: ReturnType<typeof useWhatsNew> }
    vi.useFakeTimers()
    act(() => root.render(<Probe onState={(s) => (ref.current = s)} />))
    await act(async () => {
      vi.advanceTimersByTime(20)
      await import('../src/renderer/src/whatsnew/check')
    })
    await act(async () => undefined)
    return ref
  }

  it('offers nothing on a first visit, and remembers every note as seen', async () => {
    const s = await mount()
    expect(s.current.card).toBe(false)
    expect(loadSeen()?.size).toBe(NOTES.length)
  })

  it('offers the notes you have not seen once; opening them marks them seen', async () => {
    saveSeen(NOTES.slice(1).map((n) => n.id))
    const s = await mount()
    expect(s.current.card).toBe(true)
    expect(s.current.fresh).toEqual([NOTES[0].id])
    await act(async () => {
      s.current.show()
      await import('../src/renderer/src/whatsnew/check')
    })
    expect(s.current.open).toBe(true)
    expect(s.current.card).toBe(false)
    expect(loadSeen()?.has(NOTES[0].id)).toBe(true)
  })

  it('openWhatsNew reopens the list at any time', async () => {
    saveSeen(NOTES.map((n) => n.id))
    const s = await mount()
    expect(s.current.card).toBe(false)
    act(() => openWhatsNew())
    expect(s.current.open).toBe(true)
    act(() => s.current.close())
    expect(s.current.open).toBe(false)
  })

  it('blocked or garbled storage counts as a first visit', () => {
    localStorage.setItem(SEEN_KEY, '{not json')
    expect(loadSeen()).toBeNull()
  })
})
