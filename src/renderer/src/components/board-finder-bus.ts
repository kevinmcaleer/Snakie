/**
 * Board Finder → firmware flasher bus (#893, epic #884).
 * =============================================================================
 *
 * Clicking a board in the Board Finder asks the firmware flasher to open on that
 * board, with the build already chosen. A window CustomEvent rather than a prop,
 * for the reason `settingsBus.ts` and `sprite-editor-bus.ts` use one: the gallery
 * and the flasher have no common ancestor short of the app shell, and the flasher
 * is under active change elsewhere — a seam it does not have to be edited to gain
 * is the whole point.
 *
 * WIRING THE OTHER END. Nothing listens yet. The listener belongs wherever the
 * flasher's selection state lives, and looks like every other host in this app:
 *
 * ```ts
 * useEffect(() => {
 *   const onFlashBoard = (e: Event): void => {
 *     const req = (e as CustomEvent<BoardFlashRequest>).detail
 *     setFlasherOpen(true)
 *     // req.build.url is the binary; req.port says HOW it goes on; req.flashOffset
 *     // says where. Nothing here needs the board index to be loaded.
 *   }
 *   window.addEventListener(FLASH_BOARD_EVENT, onFlashBoard)
 *   return () => window.removeEventListener(FLASH_BOARD_EVENT, onFlashBoard)
 * }, [])
 * ```
 *
 * Kept in its own tiny DOM-free module so that listener can import the event and
 * the payload type without pulling in the gallery component or the index.
 */
import { defaultBuild, type BoardBuild, type IndexedBoard } from '../../../shared/board-index'
import { flashTargetForFamily } from '../../../shared/firmware-runtime'
import type { BoardType } from '../../../main/firmware/types'

/** Window event name. `event.detail` is a {@link BoardFlashRequest}. */
export const FLASH_BOARD_EVENT = 'snakie:flash-board'

/**
 * Everything the flasher needs to act, and nothing it has to look up again — so
 * a listener never needs the board index in hand.
 */
export interface BoardFlashRequest {
  /** Upstream's board id, e.g. `ESP32_GENERIC`. */
  boardId: string
  /** e.g. `Espressif`. */
  vendor: string
  /** e.g. `ESP32 / WROOM`. */
  product: string
  /** The MicroPython port — this decides HOW the binary goes on the board:
   *  `rp2` and `samd` are a UF2 drive copy, `esp32`/`esp8266` are esptool. */
  port: string
  /** Chip family, e.g. `esp32s3`. */
  mcu: string
  /** Where the binary is written (`0x1000` on esp32), or null when upstream does
   *  not say — for a UF2 board there is no offset to say. */
  flashOffset: string | null
  /** The build to offer, already chosen: newest version, plain over variant. */
  build: BoardBuild
}

/**
 * The request for a board, or null when there is nothing to flash.
 *
 * Three of the 225 boards publish no firmware at all. Those must not dispatch:
 * an event the flasher cannot honour would open it on an empty selection, which
 * reads as the flasher being broken rather than the board having no build. The
 * gallery checks this and disables the action instead.
 */
export function flashRequestFor(board: IndexedBoard): BoardFlashRequest | null {
  const build = defaultBuild(board)
  if (!build) return null
  return {
    boardId: board.id,
    vendor: board.vendor,
    product: board.product,
    port: board.port,
    mcu: board.mcu,
    flashOffset: board.flashOffset,
    build
  }
}

/**
 * Ask the flasher to open on this board.
 *
 * Returns false when the board has no published build, so a caller that reaches
 * here anyway fails visibly rather than silently doing nothing.
 */
export function requestFlash(board: IndexedBoard): boolean {
  const detail = flashRequestFor(board)
  if (!detail) return false
  window.dispatchEvent(new CustomEvent<BoardFlashRequest>(FLASH_BOARD_EVENT, { detail }))
  return true
}

/**
 * What the flasher should select for a request (#893).
 *
 * Pure, so the mapping is testable without mounting a modal — and separate from
 * the flasher so the gallery's end and the flasher's end agree on one rule
 * rather than two.
 *
 * The OFFSET comes from upstream's own `deploy_options.flash_offset` when it
 * says, and only falls back to inference when it does not. That matters more
 * than it looks: the bootloader offset is per chip and not a simple "the
 * original ESP32 versus the rest" — the S2 shares the original's `0x1000` while
 * the S3 and every RISC-V part are `0x0`. Getting it wrong flashes cleanly and
 * leaves a dead board, so a figure the board itself publishes beats one we work
 * out.
 *
 * The chip family drives the board TYPE rather than the port, because the port
 * is too coarse: `esp32` covers the S2, S3, C3, C6 and P4, which do not share an
 * offset.
 */
export function flasherSelectionFor(req: BoardFlashRequest): {
  board: BoardType
  offset: string | undefined
  url: string
  family: string
} {
  const target = flashTargetForFamily(req.mcu || req.port)
  return {
    board: target.board,
    offset: req.flashOffset ?? target.offset,
    url: req.build.url,
    family: req.mcu || req.port
  }
}
