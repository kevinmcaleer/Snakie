import { type JSX } from 'react'
import { primaryTagCount, type FacetSelection, type Facets } from './part-facets'
import './PartFacetPanel.css'

/**
 * The catalog's filter panel (#740): type and manufacturer as proper facets,
 * tags as a ranked secondary layer with the long tail behind a disclosure.
 *
 * Counts are computed against the OTHER active filters, so a zero would be a
 * dead end — those values are disabled rather than offered. Active filters
 * appear as removable chips because a short grid with no visible reason is the
 * thing that makes people think the library is broken.
 */
export function PartFacetPanel({
  facets,
  chips,
  showAllTags,
  onToggleShowAll,
  onToggle,
  onClear,
  total
}: {
  facets: Facets
  chips: { axis: keyof FacetSelection; value: string }[]
  showAllTags: boolean
  onToggleShowAll: () => void
  onToggle: (axis: keyof FacetSelection, value: string) => void
  onClear: () => void
  total: number
}): JSX.Element | null {
  const primary = primaryTagCount(facets.tags)
  const tags = showAllTags ? facets.tags : facets.tags.slice(0, primary)
  const axis = (
    label: string,
    key: keyof FacetSelection,
    values: typeof facets.families
  ): JSX.Element | null =>
    values.length < 2 ? null : (
      <div className="pl__facet">
        <div className="pl__facet-head">{label}</div>
        <ul className="pl__facet-list" role="list">
          {values.map((v) => (
            <li key={v.value}>
              <button
                type="button"
                className={`pl__facet-btn${v.selected ? ' is-on' : ''}`}
                disabled={!v.selected && v.count === 0}
                aria-pressed={v.selected}
                onClick={() => onToggle(key, v.value)}
              >
                <span className="pl__facet-name">{v.value}</span>
                <span className="pl__facet-count">{v.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )

  if (facets.families.length < 2 && facets.manufacturers.length < 2) return null
  return (
    <div className="pl__facets">
      {chips.length > 0 && (
        <div className="pl__facet-chips">
          {chips.map((c) => (
            <button
              key={`${c.axis}:${c.value}`}
              type="button"
              className="pl__facet-chip"
              title={`Remove the ${c.value} filter`}
              onClick={() => onToggle(c.axis, c.value)}
            >
              {c.value} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="pl__facet-clear" onClick={onClear}>
            Clear
          </button>
          <span className="pl__facet-total">{total} shown</span>
        </div>
      )}
      {axis('Type', 'families', facets.families)}
      {axis('Manufacturer', 'manufacturers', facets.manufacturers)}
      {tags.length > 0 && (
        <div className="pl__facet">
          <div className="pl__facet-head">Tags</div>
          <ul className="pl__facet-list pl__facet-list--tags" role="list">
            {tags.map((v) => (
              <li key={v.value}>
                <button
                  type="button"
                  className={`pl__facet-btn${v.selected ? ' is-on' : ''}`}
                  disabled={!v.selected && v.count === 0}
                  aria-pressed={v.selected}
                  onClick={() => onToggle('tags', v.value)}
                >
                  <span className="pl__facet-name">{v.value}</span>
                  <span className="pl__facet-count">{v.count}</span>
                </button>
              </li>
            ))}
          </ul>
          {facets.tags.length > primary && (
            <button type="button" className="pl__facet-more" onClick={onToggleShowAll}>
              {showAllTags ? 'Show fewer tags' : `Show all ${facets.tags.length} tags`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

