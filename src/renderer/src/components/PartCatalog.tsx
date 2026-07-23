import { useMemo, useState, useEffect, type JSX } from 'react'
import { groupByCategory } from './part-categories'
import type { PartDefinition } from '../../../shared/part'
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
      libraries.flatMap((lib) =>
        (lib.parts ?? []).map((part) => ({ libraryId: lib.id, part, family: part.family, name: part.name }))
      ),
    [libraries]
  )

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return allItems
    return allItems.filter(({ part }) => {
      const hay = [part.name, part.description, part.family, part.partNumber, ...(part.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [allItems, q])

  // Group the filtered parts into shelves by category (same order as the panel).
  const shelves = useMemo(() => groupByCategory(filtered), [filtered])

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

        <div className="pcat__shelves">
          {shelves.length === 0 && <div className="pcat__empty">No parts match “{query}”.</div>}
          {shelves.map((shelf) => (
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
  )
}

/** One selectable item card — the whole card is the checkbox hit target. */
function CatalogCard({
  item,
  checked,
  onToggle
}: {
  item: CatalogItem
  checked: boolean
  onToggle: () => void
}): JSX.Element {
  const { part } = item
  const sku = part.partNumber || part.id
  return (
    <label className={`pcat__card${checked ? ' is-checked' : ''}`}>
      <input type="checkbox" className="pcat__card-input" checked={checked} onChange={onToggle} />
      <span className="pcat__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="pcat__check-tick" focusable="false">
          <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="pcat__card-img">
        {part.imageData ? (
          <img src={part.imageData} alt="" draggable={false} />
        ) : (
          <span className="pcat__card-noimg" style={{ background: part.pcbColor || '#2f6b4e' }} aria-hidden="true">
            {(part.name || '?').slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="pcat__card-body">
        <div className="pcat__card-top">
          <span className="pcat__card-name">{part.name}</span>
          <span className="pcat__card-sku">{sku}</span>
        </div>
        {part.description && <div className="pcat__card-desc">{part.description}</div>}
      </div>
    </label>
  )
}
