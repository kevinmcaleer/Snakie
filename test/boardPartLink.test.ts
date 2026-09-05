import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { partFromYaml } from '../src/shared/part-yaml'
import { parseBoardIndex } from '../src/shared/board-index'
import { withOverlay } from '../src/shared/board-overlay'
import {
  BOARD_PART_LINKS,
  boardLinkForPart,
  findLinkedPart,
  partLinkForBoard
} from '../src/shared/board-part-link'

/**
 * Joining the board catalogue to the parts library (#934).
 *
 * The Board Finder knows firmware; the parts library knows pads. The join lets a
 * board's details page show the actual hardware — front, back, model, pinout —
 * and it is hand-written because the obvious alternative is dangerous.
 *
 * Matching on vendor+product paired `Pimoroni Pico LiPo 2` (RP2350) with
 * upstream's `Pimoroni / Pico LiPo` (RP2040): one word apart, different chip,
 * different pinout. Showing that board's pads to someone holding the other one
 * is the failure this file exists to make impossible, so the chip check below is
 * the load-bearing test — not the spelling of any single entry.
 */

const catalogue = withOverlay(
  parseBoardIndex(JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8')))!.boards
)
const boards = new Map(catalogue.map((b) => [b.id, b]))

const partPath = (l: { libraryId: string; partId: string }): string =>
  `examples/parts/${l.libraryId}/${l.partId}/parts.yml`

const partFor = (l: { libraryId: string; partId: string }) =>
  partFromYaml(readFileSync(partPath(l), 'utf-8'))

/** Upstream's chip naming is coarser than a part's: `nrf52` covers the nRF52840,
 *  and it writes `rp2040` where a part writes `RP2040`. Same chip either way. */
const chipsAgree = (partMcu: string, boardMcu: string): boolean => {
  const p = partMcu.toLowerCase().replace(/[^a-z0-9]/g, '')
  const b = boardMcu.toLowerCase().replace(/[^a-z0-9]/g, '')
  return p === b || p.startsWith(b) || b.startsWith(p)
}

describe('every link names hardware that exists', () => {
  it.each(BOARD_PART_LINKS.map((l) => [l.boardId, l.partId] as const))(
    '%s ⇄ %s: the board is in the index',
    (boardId) => {
      expect(boards.has(boardId)).toBe(true)
    }
  )

  it.each(BOARD_PART_LINKS.map((l) => [l.partId, l] as const))(
    '%s: the part is on disk',
    (_id, link) => {
      expect(existsSync(partPath(link))).toBe(true)
    }
  )
})

describe('a link is the SAME board, not a near relative', () => {
  /**
   * The one that caught the Pico LiPo. A part and a board that disagree about
   * the chip are not the same hardware, whatever their names suggest.
   */
  it.each(BOARD_PART_LINKS.filter((l) => l.partId).map((l) => [l.boardId, l] as const))(
    '%s: part and board agree on the chip',
    (boardId, link) => {
      const board = boards.get(boardId)!
      const part = partFor(link)
      // Not every part states a chip — the board supplies it then, and there is
      // nothing to contradict.
      if (!part.mcu) return
      expect(
        chipsAgree(part.mcu, board.mcu),
        `${link.partId} is ${part.mcu}, ${boardId} is ${board.mcu}`
      ).toBe(true)
    }
  )

  it('refuses the pairing that started this', () => {
    // Pimoroni's Pico LiPo 2 is RP2350B; upstream's `PIMORONI_PICOLIPO` is the
    // RP2040 original. Name matching put them together, so the table must not —
    // and now that the Pico LiPo 2 HAS a board of its own (the overlay entry),
    // the check is sharper than "linked to nothing": it is linked to the right
    // one, and upstream's RP2040 board is still linked to no part at all.
    expect(partLinkForBoard('PIMORONI_PICOLIPO')).toBeNull()
    expect(boardLinkForPart('snakie-standard', 'pimoroni-pico-lipo-2')?.boardId).toBe(
      'PIMORONI_PICOLIPO2'
    )
    expect(chipsAgree('RP2350', 'rp2040')).toBe(false)
  })

  it('keeps the Tiny 2350 off upstream’s Tiny2040, for the same reason', () => {
    // Two Pimoroni boards one digit apart, RP2350A against RP2040.
    expect(partLinkForBoard('PIMORONI_TINY2040')).toBeNull()
    expect(boardLinkForPart('snakie-standard', 'tiny2350')?.boardId).toBe('PIMORONI_TINY2350')
  })

  it('keeps the wireless and non-wireless Picos apart', () => {
    // A Pico 2 and a Pico 2 W are different parts with a different radio; each
    // gets its own entry or none. Linking one part to both would show a CYW43439
    // on a board that has not got one.
    expect(partLinkForBoard('RPI_PICO2_W')?.partId).toBe('pico2w')
    expect(partLinkForBoard('RPI_PICO2')).toBeNull()
    expect(partLinkForBoard('RPI_PICO')?.partId).toBe('pico')
    expect(partLinkForBoard('RPI_PICO_W')?.partId).toBe('pico-w')
  })

  it('links each part to at most one board, and each board to at most one part', () => {
    const boardIds = BOARD_PART_LINKS.map((l) => l.boardId)
    const partIds = BOARD_PART_LINKS.map((l) => `${l.libraryId}/${l.partId}`)
    expect(new Set(boardIds).size).toBe(boardIds.length)
    expect(new Set(partIds).size).toBe(partIds.length)
  })
})

describe('a linked part can actually answer the pinout question', () => {
  /**
   * The point of the join is the pads. A part with no pins would light the
   * section up and then show an empty board, which is worse than not offering it.
   */
  it.each(BOARD_PART_LINKS.map((l) => [l.partId, l] as const))('%s has pins', (_id, link) => {
    const part = partFor(link)
    const header = (part.headers ?? []).reduce((n, h) => n + (h.pins?.length ?? 0), 0)
    const conn = (part.connectors ?? []).reduce((n, c) => n + (c.pins?.length ?? 0), 0)
    expect(header + conn).toBeGreaterThan(0)
  })
})

describe('looking a link up', () => {
  it('finds nothing for the boards that have no part, which is most of them', () => {
    expect(partLinkForBoard('ESP32_GENERIC')).toBeNull()
    expect(partLinkForBoard('')).toBeNull()
    expect(partLinkForBoard('NOT_A_BOARD')).toBeNull()
  })

  it('round-trips', () => {
    for (const l of BOARD_PART_LINKS) {
      expect(partLinkForBoard(l.boardId)).toEqual(l)
      expect(boardLinkForPart(l.libraryId, l.partId)).toEqual(l)
    }
  })

  it('will not match a part id from another library', () => {
    const l = BOARD_PART_LINKS[0]
    expect(boardLinkForPart('someone-elses-library', l.partId)).toBeNull()
  })

  it('says why, on every entry', () => {
    // The table is a set of claims about hardware; each one carries its reason
    // so the next person can check it rather than trust it.
    for (const l of BOARD_PART_LINKS) expect(l.why.length).toBeGreaterThan(20)
  })
})

describe('resolving the link against what is actually installed', () => {
  /**
   * The table is compiled in; the libraries are whatever this machine has. A
   * board can be linked and the part still be missing — a deleted Standard
   * library, or a web build carrying only what was bundled — and the finder must
   * then do exactly what it does for an unlinked board rather than break.
   */
  const link = partLinkForBoard('RPI_PICO')!
  const libs = [
    { id: 'snakie-standard', parts: [{ id: 'pico' }, { id: 'sg90' }] },
    { id: 'my-parts', parts: [{ id: 'pico' }] }
  ]

  it('finds the part in the library the link names', () => {
    expect(findLinkedPart(libs, link)?.id).toBe('pico')
  })

  it('will not take a same-named part from a DIFFERENT library', () => {
    // Someone's own `pico` is not necessarily this board, and showing its pads
    // for an upstream board id would be the wrong-pinout failure by another route.
    expect(findLinkedPart([{ id: 'my-parts', parts: [{ id: 'pico' }] }], link)).toBeNull()
  })

  it('is null when the library is installed but the part is gone', () => {
    expect(findLinkedPart([{ id: 'snakie-standard', parts: [{ id: 'sg90' }] }], link)).toBeNull()
  })

  it('is null for no link at all, and for no libraries at all', () => {
    expect(findLinkedPart(libs, null)).toBeNull()
    expect(findLinkedPart([], link)).toBeNull()
  })

  it('resolves every entry in the table against the bundled Standard library', () => {
    // The whole table, against a stand-in for the real library: an entry naming
    // a part that is not shipped would light a section that renders nothing.
    const standard = {
      id: 'snakie-standard',
      parts: BOARD_PART_LINKS.map((l) => ({ id: l.partId }))
    }
    for (const l of BOARD_PART_LINKS) {
      expect(findLinkedPart([standard], l)?.id, l.boardId).toBe(l.partId)
    }
  })
})
