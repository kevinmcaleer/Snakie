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
  featuresOf,
  filterBoards,
  mcusOf,
  newestBuilds,
  vendorsOf,
  defaultBuild,
  type BoardFilter,
  type IndexedBoard
} from '../../../shared/board-index'
import { loadBoardIndex, thumbUrl } from '../lib/board-index-source'
import {
  boardFacts,
  boardInitials,
  buildLabel,
  isFiltering,
  shelvesByVendor,
  toggleFeature,
  variantList
} from './board-finder'
import { requestFlash } from './board-finder-bus'
import './BoardFinder.css'

/**
 * BOARD FINDER (#893, epic #884) — the full-screen board gallery.
 * =============================================================================
 * Every board MicroPython builds for — 225 of them, 54 vendors — as a gallery
 * with the filters that actually narrow it: vendor, MCU, features, and a search
 * box. A sibling of the Parts Catalog (#613): same pop-out affordance, same
 * shelves-then-flat-grid behaviour, same details-over-the-grid detour. It differs
 * in taking its colours from the theme tokens rather than painting itself a fixed
 * light surface, because this is panel chrome and follows the skin.
 *
 * Clicking a board asks the firmware flasher to open on it with the newest build
 * already chosen — see `board-finder-bus.ts`, which is the whole of that seam.
 *
 * ON THE FILTERS. There is no storage or memory filter, though the issue asks
 * for one: upstream publishes `External Flash` / `External RAM` as booleans and
 * no figure anywhere, so a size control could only have drawn itself by quietly
 * dropping most of the catalogue. They stay as ordinary feature chips, and the
 * board's details state them plainly as present-with-no-published-size.
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

/** How many feature chips the sidebar shows before "Show all". `featuresOf`
 *  orders commonest-first, so the eight that lead are the ones worth offering;
 *  the remaining nineteen tail off into single-board curiosities. */
const FEATURE_CHIP_LIMIT = 8

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
  const [vendor, setVendor] = useState('')
  const [mcu, setMcu] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [flashableOnly, setFlashableOnly] = useState(false)
  const [showAllFeatures, setShowAllFeatures] = useState(false)
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

  const all = useMemo(() => boards ?? [], [boards])
  const filter: BoardFilter = useMemo(
    () => ({ text, vendor, mcu, features, flashableOnly }),
    [text, vendor, mcu, features, flashableOnly]
  )
  const matched = useMemo(() => filterBoards(all, filter), [all, filter])

  // The options come from the WHOLE catalogue, not the current result set: a
  // vendor list that shrinks as you filter cannot be used to change your mind.
  const vendors = useMemo(() => vendorsOf(all), [all])
  const mcus = useMemo(() => mcusOf(all), [all])
  const allFeatures = useMemo(() => featuresOf(all), [all])
  const shownFeatures = showAllFeatures ? allFeatures : allFeatures.slice(0, FEATURE_CHIP_LIMIT)

  // Shelves are for BROWSING. Once anything is narrowing the catalogue the
  // result set IS the answer, and re-sectioning it by vendor fights the vendor
  // filter that is already on screen.
  const filtering = isFiltering(filter)
  const shelves = useMemo(() => (filtering ? [] : shelvesByVendor(matched)), [filtering, matched])

  const clearFilters = useCallback((): void => {
    setText('')
    setVendor('')
    setMcu('')
    setFeatures([])
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
            <div className="bfind__facet">
              <h3 className="bfind__facet-name">Manufacturer</h3>
              <select
                className="bfind__select"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                aria-label="Filter by manufacturer"
              >
                <option value="">All manufacturers</option>
                {vendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="bfind__facet">
              <h3 className="bfind__facet-name">Processor</h3>
              <select
                className="bfind__select"
                value={mcu}
                onChange={(e) => setMcu(e.target.value)}
                aria-label="Filter by processor"
              >
                <option value="">All processors</option>
                {mcus.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="bfind__facet">
              <h3 className="bfind__facet-name">Features</h3>
              <div className="bfind__chips">
                {shownFeatures.map((f) => {
                  const on = features.includes(f)
                  return (
                    <button
                      key={f}
                      type="button"
                      className={`bfind__chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setFeatures((prev) => toggleFeature(prev, f))}
                    >
                      {f}
                    </button>
                  )
                })}
                {allFeatures.length > FEATURE_CHIP_LIMIT && (
                  <button
                    type="button"
                    className="bfind__chip"
                    onClick={() => setShowAllFeatures((v) => !v)}
                  >
                    {showAllFeatures ? 'Show fewer' : `+${allFeatures.length - FEATURE_CHIP_LIMIT} more`}
                  </button>
                )}
              </div>
            </div>

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
                  <BoardCard key={b.id} board={b} onOpen={() => setSelected(b)} />
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
                      <BoardCard key={b.id} board={b} onOpen={() => setSelected(b)} />
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
            onBack={() => setSelected(null)}
            onFlash={() => flash(selected)}
          />
        )}
      </div>
    </div>
  )
}

/** How many feature chips fit on a card before it starts to look like a list. */
const CARD_FEATURE_LIMIT = 3

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
  onBack,
  onFlash
}: {
  board: IndexedBoard
  onBack: () => void
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
        <button type="button" className="bfind__back" onClick={onBack}>
          ← All boards
        </button>
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
          <section className="bfind__section">
            <h4 className="bfind__section-name">Specification</h4>
            <dl className="bfind__facts">
              {facts.map((f) => (
                <div className="bfind__row" key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
            {/* Said out loud, because its absence is otherwise read as a bug. */}
            <p className="bfind__note">
              Flash and RAM sizes are not published in MicroPython’s board index, so
              they are not shown or filtered on here.
            </p>
          </section>

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
