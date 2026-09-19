import { describe, it, expect } from 'vitest'
import {
  BUILTIN_BOARDS,
  DEFAULT_BOARD_ID,
  boardIdFromReplText
} from '../src/renderer/src/components/board-defs'
import { resolveBoards } from '../src/renderer/src/components/part-editor.util'

/**
 * THE DEFAULT BOARD (#1163) — the Raspberry Pi Pico 2 W.
 *
 * With the instrument dock now open on launch, the mini board view is the first
 * board most people ever see in Snakie, and it is drawn from this id: the Board
 * View, the mini board and the pin source all read `snakie.board.id` and fall
 * back here. These tests pin that fallback down — including the `boards[0]`
 * second fallback both views use when an id resolves to nothing, which is a
 * different code path and must land on the same board.
 */
describe('the default board is a Raspberry Pi Pico 2 W (#1163)', () => {
  it('names the Pico 2 W as the fallback id', () => {
    expect(DEFAULT_BOARD_ID).toBe('pico2w')
    const def = BUILTIN_BOARDS.find((b) => b.id === DEFAULT_BOARD_ID)
    expect(def?.name).toBe('Raspberry Pi Pico 2 W')
  })

  it('leads the built-in registry, so the `boards[0]` fallback agrees', () => {
    expect(BUILTIN_BOARDS[0].id).toBe(DEFAULT_BOARD_ID)
  })

  it('survives a parts library that ships boards of its own', () => {
    // Library boards come FIRST in the merged list (they may override a
    // built-in), so the default must be looked up by id rather than position —
    // this is the arrangement that would break a positional default.
    const libraries = [
      {
        parts: [
          {
            id: 'some-other-board',
            name: 'Some Other Board',
            family: 'Microcontroller',
            pins: []
          }
        ]
      }
    ] as unknown as Parameters<typeof resolveBoards>[0]
    const boards = resolveBoards(libraries, [])
    expect(boards.some((b) => b.id === DEFAULT_BOARD_ID)).toBe(true)
  })

  it('is not displaced by the simulator, whose banner names no board', () => {
    // The offline simulator is MicroPython on a desktop build — its banner has
    // no board description to adopt, so REPL detection (#168) must decline and
    // leave the default standing.
    expect(boardIdFromReplText('MicroPython v1.24.0 on 2024-10-25; linux [GCC] version')).toBe(null)
    // A REAL Pico 2 W still identifies itself, of course.
    expect(
      boardIdFromReplText('MicroPython v1.24.0 on 2024-10-25; Raspberry Pi Pico 2 W with RP2350')
    ).toBe('pico2w')
  })
})
