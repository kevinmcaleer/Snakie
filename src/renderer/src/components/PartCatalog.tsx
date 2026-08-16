import { useMemo, useState, useEffect, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { groupByCategory } from './part-categories'
import { PartFacetPanel } from './PartFacetPanel'
import {
  activeChips,
  applyFilters,
  buildFacets,
  emptySelection,
  toggleFacet
} from './part-facets'
import { useCoinFlip } from '../hooks/useCoinFlip'
import { partHasRearImage } from '../../../shared/part'
import type { PartDefinition, PartSide } from '../../../shared/part'
import type { PartLibraryWithParts } from '../../../preload/index.d'
import './PartCatalog.css'

/**
 * FULL-SCREEN PART CATALOG (#613).
 * =============================================================================
 * The parts library "expanded to a full screen" — a visual catalog with a SHELF
 * per category, where every part is a stylised **checkbox card**. Click a card
 * anywhere to toggle it (a shopping-cart-style multi-select); a live "N selected"
 * count + an "Add to project →" button in the header drop them all onto the
 * project at once. A light catalog surface over a dimmed backdrop, so it reads the
 * same in both app themes.
 */

/** One selectable catalog entry — a part plus the library it came from. */
export interface CatalogItem {
  libraryId: string
  part: PartDefinition
}

export interface PartCatalogProps {
  libraries: PartLibraryWithParts[]
  onClose: () => void
  /** Add every selected part to the project in one batch. */
  onAddMany: (items: CatalogItem[]) => void
}

const keyOf = (i: CatalogItem): string => `${i.libraryId}::${i.part.id}`

export function PartCatalog({ libraries, onClose, onAddMany }: PartCatalogProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  // Which library to show — 'all' (de-duped) or a single library id.
  const [libraryId, setLibraryId] = useState<string>('all')

  // De-dupe the libraries by id, and list LOCAL (user) libraries first so their
  // part wins a duplicate-id tie in the "All libraries" view.
  const libs = useMemo(() => {
    const byId = new Map<string, PartLibraryWithParts>()
    for (const l of libraries) if (!byId.has(l.id)) byId.set(l.id, l)
    return [...byId.values()].sort((a, b) => (a.source === 'local' ? 0 : 1) - (b.source === 'local' ? 0 : 1))
  }, [libraries])

  // Esc closes the catalog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Every part across every library, flattened, carrying its library id + the
  // family/name the category grouping reads.
  const allItems = useMemo(
    () =>
      libs.flatMap((lib) =>
        (lib.parts ?? []).map((part) => ({ libraryId: lib.id, part, family: part.family, name: part.name }))
      ),
    [libs]
  )

  // The items for the chosen library — a single library, or (for 'all') every
  // library de-duped by part id so a part shared across libraries appears once.
  const visibleItems = useMemo(() => {
    if (libraryId !== 'all') return allItems.filter((i) => i.libraryId === libraryId)
    const seen = new Set<string>()
    return allItems.filter((i) => (seen.has(i.part.id) ? false : (seen.add(i.part.id), true)))
  }, [allItems, libraryId])

  const q = query.trim().toLowerCase()
  // Facets (#740) — type / manufacturer / tag, ANDed with the search box. This
  // is the full-screen view, which has the room for them; the docked panel
  // deliberately does not show them.
  const [facetSel, setFacetSel] = useState(emptySelection)
  const [showAllTags, setShowAllTags] = useState(false)
  const facets = useMemo(() => buildFacets(visibleItems, facetSel, q), [visibleItems, facetSel, q])
  const filtered = useMemo(
    () => applyFilters(visibleItems, facetSel, q),
    [visibleItems, facetSel, q]
  )

  // Group the filtered parts into shelves by category (same order as the panel).
  const shelves = useMemo(() => groupByCategory(filtered), [filtered])
  // Shelves are for BROWSING. Once a filter is on — a facet or the search box —
  // the result set is the answer, and re-sectioning it fights the sidebar that
  // already breaks the same parts down by type: filtering to one tag could leave
  // five parts across four headings, three of them holding a single card (#747).
  const filtering = q.length > 0 || activeChips(facetSel).length > 0

  const toggle = (i: CatalogItem): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      const k = keyOf(i)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const selectedItems = useMemo(() => allItems.filter((i) => selected.has(keyOf(i))), [allItems, selected])

  const add = (): void => {
    if (selectedItems.length === 0) return
    onAddMany(selectedItems.map(({ libraryId, part }) => ({ libraryId, part })))
    onClose()
  }

  return (
    <div className="pcat" role="dialog" aria-modal="true" aria-label="Parts catalog">
      <div className="pcat__backdrop" onClick={onClose} aria-hidden />
      <div className="pcat__panel">
        <header className="pcat__head">
          <span className="pcat__title">Parts Catalog</span>
          {libs.length > 1 && (
            <select
              className="pcat__lib"
              value={libraryId}
              onChange={(e) => setLibraryId(e.target.value)}
              aria-label="Filter by library"
              title="Show one library"
            >
              <option value="all">All libraries</option>
              {libs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.id}
                </option>
              ))}
            </select>
          )}
          <input
            className="pcat__search"
            type="search"
            placeholder="Search parts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search parts"
          />
          <span className="pcat__spacer" />
          <span className="pcat__count" aria-live="polite">
            {selected.size} selected
          </span>
          <button type="button" className="pcat__add" disabled={selected.size === 0} onClick={add}>
            Add to project →
          </button>
          <button type="button" className="pcat__close" onClick={onClose} aria-label="Close catalog" title="Close (Esc)">
            ✕
          </button>
        </header>

        {/* Sidebar + results, Printables-style: the filters stand in their own
            column so the grid keeps its full width and the facet list can be as
            long as it likes without pushing the parts down the page. */}
        <div className="pcat__body">
          <aside className="pcat__sidebar">
            <PartFacetPanel
              facets={facets}
              chips={activeChips(facetSel)}
              showAllTags={showAllTags}
              onToggleShowAll={() => setShowAllTags((v) => !v)}
              onToggle={(axis, value) => setFacetSel((sel) => toggleFacet(sel, axis, value))}
              onClear={() => setFacetSel(emptySelection())}
              total={filtered.length}
            />
          </aside>

          <div className="pcat__shelves">
            {filtered.length === 0 && (
              <div className="pcat__empty">
                {query ? `No parts match “${query}”.` : 'No parts match these filters.'}
              </div>
            )}
            {/* Filtered ⇒ ONE grid. The card carries the type the shelf heading
                used to supply, so collapsing loses nothing. */}
            {filtering && filtered.length > 0 && (
              <div className="pcat__grid">
                {filtered.map((item) => (
                  <CatalogCard
                    key={keyOf(item)}
                    item={item}
                    checked={selected.has(keyOf(item))}
                    onToggle={() => toggle(item)}
                    showType
                  />
                ))}
              </div>
            )}
            {!filtering &&
              shelves.map((shelf) => (
              <section className="pcat__shelf" key={shelf.category}>
                <h3 className="pcat__shelf-name">
                  {shelf.category}
                  <span className="pcat__shelf-count">{shelf.items.length}</span>
                </h3>
                <div className="pcat__grid">
                  {shelf.items.map((item) => (
                    <CatalogCard
                      key={keyOf(item)}
                      item={item}
                      checked={selected.has(keyOf(item))}
                      onToggle={() => toggle(item)}
                    />
                  ))}
                </div>
                </section>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** One selectable item card — the whole card is the checkbox hit target. */
function CatalogCard({
  item,
  checked,
  onToggle,
  showType = false
}: {
  item: CatalogItem
  checked: boolean
  onToggle: () => void
  /** Show the part's type on the card. Set in the FLAT (filtered) grid, where
   *  there is no shelf heading saying it (#747). */
  showType?: boolean
}): JSX.Element {
  const { part } = item
  const sku = part.partNumber || part.id
  // Hover turns the board over — but only when there is a back to SEE. A part
  // with rear pins and no rear photo would spin to a blank face, which reads as
  // the image failing to load.
  const rearImage = partHasRearImage(part) ? part.rear?.imageData : undefined
  const { face, flipping, flipTo } = useCoinFlip()
  const shown = face === 'rear' ? (rearImage ?? part.imageData) : part.imageData
  // Touch has no hover: a tap would flip the board AND tick the checkbox, and
  // nothing would ever flip it back.
  const hover = (next: PartSide) => (e: ReactPointerEvent) => {
    if (!rearImage || e.pointerType === 'touch') return
    flipTo(next)
  }
  return (
    <label
      className={`pcat__card${checked ? ' is-checked' : ''}`}
      onPointerEnter={hover('rear')}
      onPointerLeave={hover('front')}
    >
      <input type="checkbox" className="pcat__card-input" checked={checked} onChange={onToggle} />
      <span className="pcat__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="pcat__check-tick" focusable="false">
          <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="pcat__card-top">
        <span className="pcat__card-name">{part.name}</span>
        <span className="pcat__card-sku">{sku}</span>
      </div>
      <div className={`pcat__card-img${flipping ? ' is-flipping' : ''}`}>
        {shown ? (
          <img src={shown} alt="" draggable={false} />
        ) : (
          <span className="pcat__card-noimg" style={{ background: part.pcbColor || '#2f6b4e' }} aria-hidden="true">
            {(part.name || '?').slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="pcat__card-body">
        {showType && part.family && <div className="pcat__card-type">{part.family}</div>}
        {part.description && <div className="pcat__card-desc">{part.description}</div>}
      </div>
    </label>
  )
}
