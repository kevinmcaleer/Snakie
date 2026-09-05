import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX
} from 'react'
import {
  boardsWithoutRam,
  featureOptions,
  filterBoards,
  mcuOptions,
  newestBuilds,
  runtimeCounts,
  vendorOptions,
  defaultBuild,
  type BoardFilter,
  type FacetOption,
  type IndexedBoard
} from '../../../shared/board-index'
import { withOverlay } from '../../../shared/board-overlay'
import {
  FIRMWARE_RUNTIMES,
  FIRMWARE_RUNTIME_LABEL,
  type FirmwareRuntime
} from '../../../shared/firmware-runtime'
import { loadBoardIndex, thumbUrl } from '../lib/board-index-source'
import {
  MEMORY_CAVEAT,
  MEMORY_THRESHOLDS,
  RUNTIME_CAVEAT,
  boardFacts,
  boardInitials,
  buildLabel,
  firmwareSummary,
  isFiltering,
  memoryThresholdLabel,
  peekFacts,
  shelvesByVendor,
  toggleChip,
  toggleRuntime,
  unsizedNotice,
  variantList
} from './board-finder'
import { requestFlash } from './board-finder-bus'
import './BoardFinder.css'

/**
 * BOARD FINDER (#893, epic #884) — the full-screen board gallery.
 * =============================================================================
 * Every board MicroPython builds for — 225 of them, 54 vendors — as a gallery
 * with the filters that actually narrow it: manufacturer, processor, features,
 * and a search box. A sibling of the Parts Catalog (#613): same pop-out
 * affordance, same shelves-then-flat-grid behaviour, same details-over-the-grid
 * detour. Unlike the rest of the app's chrome it is DARK in both skins — see
 * `BoardFinder.css`, which says why, and why that is not an oversight to tidy up.
 *
 * Clicking a board asks the firmware flasher to open on it with the newest build
 * already chosen — see `board-finder-bus.ts`, which is the whole of that seam.
 *
 * RESTING on a board opens a preview instead (#919): the same card, grown, with
 * the facts that decide whether it is the one — see {@link BoardCell} for the
 * three things that keep that from pouncing, and for how it is reached without a
 * pointer at all.
 *
 * ON THE FILTERS. MEMORY is a filter now (#897): 226 of the 230 boards have a
 * sourced RAM figure, up from 86, and it is one comparable quantity. The four
 * without one are COUNTED and named under the control rather than quietly
 * dropped — see `boardsWithoutRam`. STORAGE still is not, and no longer for want
 * of numbers: the flash figures are 107 chip-internal and 80 on-module, which
 * are different quantities to rank against each other. `board-finder.ts` argues
 * both at length. The RUNTIME filter (#902) ships on the same terms — see
 * `RUNTIME_CAVEAT` for the limits it prints under itself.
 *
 * ON THE BOARDS. The list is upstream's plus `board-overlay.ts` — boards
 * MicroPython builds no firmware for under any name, which is why the Adafruit
 * ESP32 Feather V2 that started this epic was unfindable. They carry a `snakie`
 * origin and say on the card whose build they flash.
 */

export interface BoardFinderProps {
  onClose: () => void
  /** Viewport centre of the control that opened it, so it can grow out of it.
   *  Absent means no animation rather than one from an arbitrary corner. */
  origin?: { x: number; y: number } | null
  /** Play the closing animation. The caller keeps this mounted until it hears
   *  {@link onClosed} — unmounting on the click leaves nothing to animate. */
  closing?: boolean
  /** The shrink has finished; safe to unmount. */
  onClosed?: () => void
}

/** How many feature chips the sidebar shows before the disclosure.
 *  `featureOptions` orders commonest-first, so the eight that lead are the ones
 *  worth offering; the remaining nineteen tail off into single-board curiosities. */
const FEATURE_CHIP_LIMIT = 8

/**
 * The same, for the two long facets — 54 manufacturers and 41 chip families
 * (#919).
 *
 * Ten, because ten is where the collapsed list stops being a sample and starts
 * being an answer: the ten commonest makers are 135 of the 225 boards and the ten
 * commonest chip families 155, so most people's board is named before they open
 * anything. Twice that would fill the sidebar to no purpose — the tail is makers
 * of one or two boards each, which is a list to search, not to scan, and the
 * search box already matches on manufacturer.
 */
const LONG_FACET_LIMIT = 10

export function BoardFinder({ onClose, origin, closing, onClosed }: BoardFinderProps): JSX.Element {
  // The panel is inset from the viewport, so the button's viewport position has
  // to be re-expressed in the PANEL's own box before it can be a transform-origin
  // — measured rather than assumed, so the two cannot drift apart.
  const panelRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el || !origin) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--bfind-ox', `${origin.x - r.left}px`)
    el.style.setProperty('--bfind-oy', `${origin.y - r.top}px`)
  }, [origin])

  const [boards, setBoards] = useState<IndexedBoard[] | null>(null)
  const [generated, setGenerated] = useState('')
  const [micropython, setMicropython] = useState('')

  // The seed draws immediately; `onUpdate` fires only if a genuinely newer
  // published document arrives, so there is no spinner to sit through.
  useEffect(() => {
    let live = true
    void loadBoardIndex((next) => {
      if (!live) return
      setBoards(next.boards)
      setGenerated(next.generated)
      setMicropython(next.micropython)
    }).then((index) => {
      if (!live) return
      setBoards(index.boards)
      setGenerated(index.generated)
      setMicropython(index.micropython)
    })
    return () => {
      live = false
    }
  }, [])

  const [text, setText] = useState('')
  // Manufacturer and processor are SETS now (#919), and ticking two of either
  // means "or" — see `BoardFilter`, which is where that rule is stated and
  // tested, because it is the opposite of what ticking two features means.
  const [vendors, setVendors] = useState<string[]>([])
  const [mcus, setMcus] = useState<string[]>([])
  // A size threshold, not a facet: one comparable number rather than a set
  // of values, so it gets its own control and its own clause (#897).
  const [minRam, setMinRam] = useState(0)
  const [features, setFeatures] = useState<string[]>([])
  const [runtimes, setRuntimes] = useState<FirmwareRuntime[]>([])
  const [flashableOnly, setFlashableOnly] = useState(false)
  // Which facets are showing their whole list, by facet name — so a fifth facet
  // needs no fifth flag.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggleExpanded = useCallback((name: string): void => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }))
  }, [])
  // The board whose details are open, or null for the grid. A DETOUR, as in the
  // Parts Catalog: the details render OVER the grid, which stays mounted, so
  // closing them restores the filters and the scroll position by never having
  // torn them down.
  const [selected, setSelected] = useState<IndexedBoard | null>(null)

  // Esc backs out one step: out of a board's details first, then the gallery.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (selected) setSelected(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, selected])

  // The overlay is applied HERE rather than in the loader, so it re-applies to
  // whichever document won — including one fetched later that may already carry
  // a board the overlay is standing in for, which `withOverlay` then drops.
  const all = useMemo(() => (boards ? withOverlay(boards) : []), [boards])
  const filter: BoardFilter = useMemo(
    () => ({ text, vendors, mcus, minRam: minRam || undefined, features, runtimes, flashableOnly }),
    [text, vendors, mcus, minRam, features, runtimes, flashableOnly]
  )
  const matched = useMemo(() => filterBoards(all, filter), [all, filter])
  // Boards the memory filter drops for having no figure rather than too small a
  // one. Counted so the gallery can SAY so — a size control that quietly loses
  // the undocumented boards is the one thing #897 set out not to build.
  const unsized = useMemo(
    () => (minRam ? unsizedNotice(boardsWithoutRam(all, filter).length) : null),
    [all, filter, minRam]
  )

  // The options come from the WHOLE catalogue, not the current result set: a
  // vendor list that shrinks as you filter cannot be used to change your mind.
  const vendorChips = useMemo(() => vendorOptions(all), [all])
  const mcuChips = useMemo(() => mcuOptions(all), [all])
  const featureChips = useMemo(() => featureOptions(all), [all])
  // Printed on the runtime chips. The number is the point: "CircuitPython 49"
  // reads as a confirmed subset, where a bare chip would read as the answer.
  const runtimeChips = useMemo<FacetOption[]>(() => {
    const counts = runtimeCounts(all)
    return FIRMWARE_RUNTIMES.map((r) => ({ value: r, count: counts[r] }))
  }, [all])

  // Shelves are for BROWSING. Once anything is narrowing the catalogue the
  // result set IS the answer, and re-sectioning it by vendor fights the vendor
  // filter that is already on screen.
  const filtering = isFiltering(filter)
  const shelves = useMemo(() => (filtering ? [] : shelvesByVendor(matched)), [filtering, matched])

  const clearFilters = useCallback((): void => {
    setText('')
    setVendors([])
    setMcus([])
    setMinRam(0)
    setFeatures([])
    setRuntimes([])
    setFlashableOnly(false)
  }, [])

  const flash = useCallback(
    (board: IndexedBoard): void => {
      if (requestFlash(board)) onClose()
    },
    [onClose]
  )

  return (
    <div className="bfind" role="dialog" aria-modal="true" aria-label="Board Finder">
      <div className="bfind__backdrop" onClick={onClose} aria-hidden />
      <div
        className={`bfind__panel${closing ? ' is-closing' : origin ? ' is-growing' : ''}`}
        ref={panelRef}
        // Only the panel's OWN animation ends the close: the details view
        // animates inside it and bubbles its event up here.
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClosed?.()
        }}
      >
        <header className="bfind__head">
          <span className="bfind__title">Board Finder</span>
          {micropython && (
            <span className="bfind__meta" title={`Board index generated ${generated}`}>
              {micropython}
            </span>
          )}
          <input
            className="bfind__search"
            type="search"
            placeholder="Search boards…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Search boards"
          />
          <span className="bfind__spacer" />
          <span className="bfind__count" aria-live="polite">
            {boards === null ? '' : `${matched.length} of ${all.length} boards`}
          </span>
          <button
            type="button"
            className="bfind__close"
            onClick={onClose}
            aria-label="Close Board Finder"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="bfind__body">
          <aside className="bfind__sidebar">
            {/* Four facets, one control. They differ only in what a tick means,
                and that lives in `matchesFilter` where it is tested. */}
            <ChipFacet
              name="Manufacturer"
              options={vendorChips}
              selected={vendors}
              limit={LONG_FACET_LIMIT}
              expanded={expanded.vendor === true}
              onToggleExpand={() => toggleExpanded('vendor')}
              onToggle={(v) => setVendors((prev) => toggleChip(prev, v))}
            />

            <ChipFacet
              name="Processor"
              options={mcuChips}
              selected={mcus}
              limit={LONG_FACET_LIMIT}
              expanded={expanded.mcu === true}
              onToggleExpand={() => toggleExpanded('mcu')}
              onToggle={(m) => setMcus((prev) => toggleChip(prev, m))}
            />

            <ChipFacet
              name="Runtime"
              options={runtimeChips}
              selected={runtimes}
              label={(r) => FIRMWARE_RUNTIME_LABEL[r as FirmwareRuntime]}
              onToggle={(r) => setRuntimes((prev) => toggleRuntime(prev, r as FirmwareRuntime))}
              note={RUNTIME_CAVEAT}
            />
            <div className="bfind__facet">
              <h3 className="bfind__facet-name">Memory</h3>
              <select
                className="bfind__select"
                value={minRam || ''}
                onChange={(e) => setMinRam(Number(e.target.value) || 0)}
                aria-label="Filter by on-chip RAM"
              >
                <option value="">Any amount of RAM</option>
                {MEMORY_THRESHOLDS.map((bytes) => (
                  <option key={bytes} value={bytes}>
                    {memoryThresholdLabel(bytes)}
                  </option>
                ))}
              </select>
              {/* What the control filters on is the chip's SRAM, which is not
                  the whole story on a board with PSRAM. Said here rather than
                  left to be discovered. */}
              <p className="bfind__facet-note">{MEMORY_CAVEAT}</p>
              {unsized && <p className="bfind__facet-note is-warn">{unsized}</p>}
            </div>

            <ChipFacet
              name="Features"
              options={featureChips}
              selected={features}
              limit={FEATURE_CHIP_LIMIT}
              expanded={expanded.feature === true}
              onToggleExpand={() => toggleExpanded('feature')}
              onToggle={(f) => setFeatures((prev) => toggleChip(prev, f))}
            />

            <div className="bfind__facet">
              <label className="bfind__toggle">
                <input
                  type="checkbox"
                  checked={flashableOnly}
                  onChange={(e) => setFlashableOnly(e.target.checked)}
                />
                Only boards with firmware
              </label>
            </div>

            {filtering && (
              <button type="button" className="bfind__clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </aside>

          <div className="bfind__shelves">
            {boards === null && <div className="bfind__loading">Loading boards…</div>}
            {boards !== null && matched.length === 0 && (
              <div className="bfind__empty">
                {all.length === 0
                  ? 'The board index could not be read.'
                  : 'No boards match these filters.'}
              </div>
            )}

            {/* Filtered ⇒ ONE grid; the card carries the vendor the shelf
                heading used to supply, so collapsing loses nothing. */}
            {filtering && matched.length > 0 && (
              <div className="bfind__grid">
                {matched.map((b) => (
                  <BoardCell key={b.id} board={b} onOpen={() => setSelected(b)} />
                ))}
              </div>
            )}

            {!filtering &&
              shelves.map((shelf) => (
                <section className="bfind__shelf" key={shelf.vendor}>
                  <h3 className="bfind__shelf-name">
                    {shelf.vendor}
                    <span className="bfind__shelf-count">{shelf.boards.length}</span>
                  </h3>
                  <div className="bfind__grid">
                    {shelf.boards.map((b) => (
                      <BoardCell key={b.id} board={b} onOpen={() => setSelected(b)} />
                    ))}
                  </div>
                </section>
              ))}
          </div>
        </div>

        {selected && (
          <BoardDetails
            key={selected.id}
            board={selected}
            onClose={() => setSelected(null)}
            onFlash={() => flash(selected)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * One filter facet: a ranked row of chips, with the long tail behind a
 * disclosure (#919).
 *
 * Every facet in the sidebar is this control. Manufacturer and processor used to
 * be dropdowns, which hold one value and hide the other 53 behind a click — a
 * chip row says what the catalogue is made of before anything is chosen, and the
 * count on each chip is what makes the commonest-first order legible rather than
 * arbitrary.
 *
 * `limit` absent means no disclosure: the runtime facet has two options and
 * nothing to hide.
 */
function ChipFacet({
  name,
  options,
  selected,
  onToggle,
  limit,
  expanded,
  onToggleExpand,
  label,
  note
}: {
  name: string
  options: readonly FacetOption[]
  selected: readonly string[]
  onToggle: (value: string) => void
  limit?: number
  expanded?: boolean
  onToggleExpand?: () => void
  /** What the chip says, where that is not the value itself. */
  label?: (value: string) => string
  /** What this facet cannot claim, printed under it. */
  note?: string
}): JSX.Element | null {
  if (options.length === 0) return null
  const hidden = limit === undefined || expanded ? 0 : Math.max(0, options.length - limit)
  const shown = hidden > 0 ? options.slice(0, limit) : options
  return (
    <div className="bfind__facet">
      <h3 className="bfind__facet-name">{name}</h3>
      <div className="bfind__chips">
        {shown.map((o) => {
          const on = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              className={`bfind__chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onToggle(o.value)}
            >
              {label ? label(o.value) : o.value}
              <span className="bfind__chip-n">{o.count}</span>
            </button>
          )
        })}
      </div>
      {limit !== undefined && onToggleExpand && options.length > limit && (
        <button type="button" className="bfind__more" onClick={onToggleExpand}>
          {expanded ? 'Show less' : `Show ${options.length - limit} more`}
        </button>
      )}
      {note && <p className="bfind__facet-note">{note}</p>}
    </div>
  )
}

/** How many feature chips fit on a card before it starts to look like a list. */
const CARD_FEATURE_LIMIT = 3

/** And on the preview, which has room for more but still a height to keep. */
const PEEK_FEATURE_LIMIT = 6

/**
 * How long a pointer must REST on a card before its preview opens.
 *
 * Long enough that crossing the grid on the way to the sidebar opens nothing —
 * the timer is per-card and dies on the way out — and short enough that resting
 * on a board feels like an answer rather than a wait.
 */
const PEEK_DELAY_MS = 400

/** Roughly how far the preview grows past the card. Only the flip decision reads
 *  it, and only to choose a direction, so an estimate is the right precision. */
const PEEK_OVERHANG_PX = 180

/**
 * One board in the grid, and its hover preview (#919).
 *
 * The preview is the Netflix move: rest on a card and it grows into a bigger one
 * carrying the facts that decide whether this is your board, with a disclosure
 * into the full page. Three things stop it pouncing:
 *
 *   - the DELAY. A pointer crossing the grid on its way somewhere else leaves
 *     before the timer fires, so nothing opens behind it.
 *   - MOUSE only. A touch that "hovers" is really a tap, and a tap already opens
 *     the full page — so `pointerType` gates it and touch keeps the plain card.
 *   - FOCUS opens it at once, with no timer, because focus is deliberate in a way
 *     that a pointer passing over is not.
 *
 * That last one is also the whole keyboard story: tab to a card and the preview
 * is there, its Details button the next stop after it, and Enter on the card
 * itself doing exactly what that button does. Nothing here is reachable only by
 * hovering.
 */
function BoardCell({ board, onOpen }: { board: IndexedBoard; onOpen: () => void }): JSX.Element {
  const [peeking, setPeeking] = useState(false)
  // Grow UPWARD when there is no room below inside the scroller: the bottom row
  // is otherwise a preview clipped to the two lines that were already visible.
  const [up, setUp] = useState(false)
  const cell = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)

  const cancel = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setPeeking(false)
  }, [])
  // A card scrolled or filtered away mid-wait must not open a preview onto
  // whatever took its place.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const open = useCallback((): void => {
    const el = cell.current
    const scroller = el?.closest('.bfind__shelves')
    if (el && scroller) {
      const room = scroller.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
      setUp(room < PEEK_OVERHANG_PX)
    }
    setPeeking(true)
  }, [])

  const openDetails = useCallback((): void => {
    cancel()
    onOpen()
  }, [cancel, onOpen])

  return (
    <div
      className={`bfind__cell${peeking ? ' is-peeking' : ''}`}
      ref={cell}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        timer.current = window.setTimeout(open, PEEK_DELAY_MS)
      }}
      onPointerLeave={cancel}
      onFocus={(e) => {
        // KEYBOARD focus only, and `:focus-visible` is the browser's own answer
        // to which is which. A click focuses the card too — and a preview that
        // appeared between pointerdown and pointerup would take the pointerup
        // for itself, leaving the click to land on the cell instead of the card
        // and the board never opening at all.
        if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) open()
      }}
      onBlur={(e) => {
        // Tabbing from the card to its own Details button must not close the
        // thing that button sits on.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cancel()
      }}
    >
      <BoardCard board={board} onOpen={openDetails} />
      {peeking && <BoardPeek board={board} up={up} onOpen={openDetails} />}
    </div>
  )
}

/**
 * The preview's contents: what the card shows, plus what it could not fit.
 *
 * It repeats the photo and the name because it covers the card it grew out of —
 * a preview that dropped them would read as some other board's.
 */
function BoardPeek({
  board,
  up,
  onOpen
}: {
  board: IndexedBoard
  up: boolean
  onOpen: () => void
}): JSX.Element {
  const src = thumbUrl(board.thumb)
  const facts = peekFacts(board)
  const extra = board.features.length - PEEK_FEATURE_LIMIT
  return (
    <div
      className={`bfind__peek${up ? ' is-up' : ''}`}
      role="group"
      aria-label={`More about ${board.vendor} ${board.product}`}
      // The preview covers the card it grew out of, so it has to accept the
      // click the card would have taken. Its Details button is the same action
      // said out loud, for the keyboard and for anyone who wants a target.
      onClick={onOpen}
    >
      <div className="bfind__peek-img">
        {src ? (
          <img src={src} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="bfind__noimg" aria-hidden="true">
            {boardInitials(board)}
          </span>
        )}
      </div>
      <div className="bfind__peek-body">
        <div className="bfind__card-vendor">{board.vendor || 'Unknown'}</div>
        <div className="bfind__peek-name">{board.product}</div>
        {/* First, because having nothing to flash is what disqualifies a board. */}
        <div className={`bfind__peek-fw${board.builds.length === 0 ? ' is-none' : ''}`}>
          {firmwareSummary(board)}
        </div>
        <dl className="bfind__peek-facts">
          {facts.map((f) => (
            <div className="bfind__row" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        {board.features.length > 0 && (
          <div className="bfind__card-feats">
            {board.features.slice(0, PEEK_FEATURE_LIMIT).map((f) => (
              <span className="bfind__feat" key={f}>
                {f}
              </span>
            ))}
            {extra > 0 && <span className="bfind__feat">+{extra}</span>}
          </div>
        )}
        {board.substitute?.build && (
          <div className="bfind__card-sub">Flashes {board.substitute.build}</div>
        )}
        <button type="button" className="bfind__peek-open" onClick={onOpen}>
          Details
        </button>
      </div>
    </div>
  )
}

/** One board in the grid. */
function BoardCard({
  board,
  onOpen
}: {
  board: IndexedBoard
  onOpen: () => void
}): JSX.Element {
  const src = thumbUrl(board.thumb)
  const extra = board.features.length - CARD_FEATURE_LIMIT
  return (
    <button type="button" className="bfind__card" onClick={onOpen}>
      <span className="bfind__card-img">
        {src ? (
          // 217 of these, so they load as they are scrolled to rather than all
          // at once. The alt is empty because the card's own text names the
          // board — announcing it twice is noise, not access.
          <img src={src} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="bfind__noimg" aria-hidden="true">
            {boardInitials(board)}
          </span>
        )}
      </span>
      <span className="bfind__card-body">
        <span className="bfind__card-vendor">{board.vendor || 'Unknown'}</span>
        <span className="bfind__card-name">{board.product}</span>
        <span className="bfind__card-mcu">{board.mcu}</span>
        {board.features.length > 0 && (
          <span className="bfind__card-feats">
            {board.features.slice(0, CARD_FEATURE_LIMIT).map((f) => (
              <span className="bfind__feat" key={f}>
                {f}
              </span>
            ))}
            {extra > 0 && <span className="bfind__feat">+{extra}</span>}
          </span>
        )}
        {/* Said on the FACE of the card, not buried in the details: picking a
            board whose firmware is really another board's is the exact mistake
            this epic exists to stop someone making by accident. */}
        {board.substitute?.build && (
          <span className="bfind__card-sub">Flashes {board.substitute.build}</span>
        )}
        {board.builds.length === 0 && (
          <span className="bfind__card-nofw">No published firmware</span>
        )}
      </span>
    </button>
  )
}

/** A board's full details, over the grid rather than instead of it. */
function BoardDetails({
  board,
  onClose,
  onFlash
}: {
  board: IndexedBoard
  onClose: () => void
  onFlash: () => void
}): JSX.Element {
  const src = thumbUrl(board.thumb)
  const facts = boardFacts(board)
  const variants = variantList(board)
  const builds = newestBuilds(board)
  const chosen = defaultBuild(board)

  return (
    <div className="bfind__details" role="group" aria-label={`${board.vendor} ${board.product}`}>
      <header className="bfind__det-head">
        <span className="bfind__det-title">
          <span className="bfind__det-vendor">{board.vendor || 'Unknown'}</span>
          <span className="bfind__det-name">{board.product}</span>
        </span>
        <span className="bfind__spacer" />
        <button
          type="button"
          className="bfind__flash"
          onClick={onFlash}
          disabled={!chosen}
          title={
            chosen
              ? `Flash MicroPython ${chosen.version} (${buildLabel(chosen)}) to a ${board.product}`
              : 'MicroPython publishes no firmware for this board'
          }
        >
          {chosen ? `⚡ Flash MicroPython ${chosen.version}` : 'No firmware published'}
        </button>
        {/* The way out is an X in the top-right corner (#919), where a
            full-screen view's close always is — and it is the same control, in
            the same place, as the gallery's own. The "← All boards" button it
            replaces sat in the top LEFT, which gave one view two exits in two
            different idioms. Esc still does it too. */}
        <button
          type="button"
          className="bfind__close"
          onClick={onClose}
          aria-label="Close board details"
          title="Back to the boards (Esc)"
        >
          ✕
        </button>
      </header>

      <div className="bfind__det-body">
        <div className="bfind__det-img">
          {src ? (
            <img src={src} alt={`${board.vendor} ${board.product}`} loading="lazy" />
          ) : (
            <span className="bfind__noimg" aria-hidden="true">
              {boardInitials(board)}
            </span>
          )}
        </div>

        <div>
          {/* First, above the specification, because it changes what "flash
              this board" means. */}
          {board.substitute && (
            <section className="bfind__section bfind__sub">
              <h4 className="bfind__section-name">
                {board.substitute.build
                  ? `Flashes ${board.substitute.build}`
                  : 'Firmware comes from elsewhere'}
              </h4>
              <p className="bfind__note">{board.substitute.why}</p>
            </section>
          )}

          <section className="bfind__section">
            <h4 className="bfind__section-name">Specification</h4>
            <dl className="bfind__facts">
              {facts.map((f) => (
                <div className="bfind__row" key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.value}
                    {f.source && <span className="bfind__src">{f.source}</span>}
                  </dd>
                </div>
              ))}
            </dl>
            {/* Said out loud, because its absence is otherwise read as a bug. */}
            <p className="bfind__note">
              MicroPython’s board index publishes no flash or RAM sizes, so every figure
              above names where it came from. A board with none simply has no sourced
              figure yet — which is also why storage and memory are not filters.
            </p>
          </section>

          {board.circuitPythonBoardId && (
            <section className="bfind__section">
              <h4 className="bfind__section-name">Also runs CircuitPython</h4>
              {/* The board id, because it is the thing that matters:
                  CircuitPython builds are per BOARD, and this exact string is
                  what its download is filed under and what `boot_out.txt`
                  prints. Flashing a neighbouring board's `.uf2` is a board that
                  needs re-flashing before it will talk again. */}
              <p className="bfind__note">
                CircuitPython board id{' '}
                <code className="bfind__code">{board.circuitPythonBoardId}</code>. Choose
                CircuitPython in the flash dialog to put it on.
              </p>
            </section>
          )}

          {board.features.length > 0 && (
            <section className="bfind__section">
              <h4 className="bfind__section-name">Features</h4>
              <div className="bfind__feats-big">
                {board.features.map((f) => (
                  <span className="bfind__feat" key={f}>
                    {f}
                  </span>
                ))}
                {/* Upstream's `notes` are attributes it marks as NOT worth
                    filtering on — still worth reading, so they sit here. */}
                {board.notes.map((n) => (
                  <span className="bfind__feat" key={n}>
                    {n}
                  </span>
                ))}
              </div>
            </section>
          )}

          {variants.length > 0 && (
            <section className="bfind__section">
              <h4 className="bfind__section-name">Variants</h4>
              {/* Upstream's own words — a variant's purpose is exactly the thing
                  a picker cannot infer, and getting it wrong is what #893 is about. */}
              <dl className="bfind__variants">
                {variants.map((v) => (
                  <div className="bfind__row" key={v.variant}>
                    <dt>{v.variant}</dt>
                    <dd>{v.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="bfind__section">
            <h4 className="bfind__section-name">Builds</h4>
            {builds.length === 0 ? (
              <p className="bfind__note">
                MicroPython publishes no firmware for this board, so it cannot be flashed
                from here.
              </p>
            ) : (
              <ul className="bfind__builds">
                {builds.map((b) => (
                  <li className="bfind__build" key={b.build}>
                    <span className="bfind__build-name">{buildLabel(b)}</span>
                    <span className="bfind__build-ver">v{b.version}</span>
                    {chosen && b.build === chosen.build && (
                      <span className="bfind__build-default">Default</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {board.url && (
            <section className="bfind__section">
              <a
                className="bfind__link"
                href={board.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {board.vendor} product page ↗
              </a>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
