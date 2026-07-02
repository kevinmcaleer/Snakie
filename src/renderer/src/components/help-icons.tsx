import type { JSX } from 'react'

/**
 * Book-family icons for the Help Library tree (TechNet document-tree semantics):
 * shelf = library root, tome = a collection, open book = expanded section,
 * closed book = collapsed section, page = a leaf article. All 24×24, currentColor
 * so each node can tint them per the design.
 */

const svg = (children: JSX.Element, extra?: number): JSX.Element => (
  <svg width={extra ?? 15} height={extra ?? 15} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {children}
  </svg>
)

/** Books on a shelf — the library root. */
export const ShelfIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M5 4h3v13H5z M9 5h3v12H9z" />
      <path d="M14 6l3-.6 2.4 12.5-3 .6z" />
      <path d="M3 19.5h18" strokeLinecap="round" strokeWidth="1.8" />
    </g>,
    size
  )

/** Stacked books — a collection. */
export const TomeIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="4" y="15.5" width="16" height="4.2" rx="1" />
      <rect x="5" y="10.8" width="14" height="4.2" rx="1" />
      <rect x="6.5" y="6" width="11" height="4.2" rx="1" />
    </g>,
    size
  )

/** An open book — an expanded section. */
export const OpenBookIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 7c-2-1.4-4.4-1.6-7-1v11c2.6-.6 5-.4 7 1 2-1.4 4.4-1.6 7-1V6c-2.6-.6-5-.4-7 1z" />
      <path d="M12 7v12" />
    </g>,
    size
  )

/** A closed book — a collapsed section. */
export const ClosedBookIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M6.5 4h10a1.5 1.5 0 0 1 1.5 1.5V20l-2-1.3-2 1.3V4" />
      <path d="M6.5 4A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H18" strokeLinecap="round" />
    </g>,
    size
  )

/** A document — a leaf article. */
export const PageIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12h6M9.5 15h6M9.5 18h4" strokeLinecap="round" strokeWidth="1.3" />
    </g>,
    size
  )

/** A text-caret arrow — the "at cursor" badge glyph. */
export const CursorIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    <g fill="currentColor">
      <path d="M6 3l13 8-5.4 1.4L16 18l-2.4 1-2.4-5.4L7 17z" />
    </g>,
    size
  )
