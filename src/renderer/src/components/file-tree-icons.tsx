/**
 * Icons shared by the two file panels' toolbars (#868).
 * =============================================================================
 *
 * Refresh, New file and New folder were defined SEPARATELY in `LocalFileTree`
 * and `DeviceFileTree` — byte-for-byte identical, including the `iconProps`
 * that size them. Two copies of the same drawing is how two toolbars that are
 * meant to match stop matching, which is what #868 is about. One definition,
 * imported by both, cannot drift.
 *
 * Conventions differ from {@link file://./ui-icons.tsx} on purpose: these are a
 * 16×16 box drawn with FILLS and `crispEdges`, matching the file panels' dense
 * 14px chrome, where `ui-icons` is a 24×24 stroked set for larger surfaces.
 *
 * OPTICAL SIZE. Every glyph here is drawn inside roughly x/y 1..15 with its
 * visual mass in 3..13, so they read as the same size sitting side by side. A
 * glyph that fills more of its box looks bigger even at identical dimensions —
 * that was the device panel's sync arrows, reported in #868 as "ever so
 * slightly larger". They were not larger; they were drawn 14 units wide next to
 * neighbours drawn 10.
 */

/** Shared sizing for every file-panel icon — 14px in a 16-unit box. */
export const iconProps = {
  viewBox: '0 0 16 16',
  width: 14,
  height: 14,
  shapeRendering: 'crispEdges' as const,
  'aria-hidden': true,
  focusable: false
}

/** Page with a `+` — new file. */
export const NewFileIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M3 1h6l4 4v10H3z M9 1v4h4" />
      <rect x="7" y="8" width="2" height="6" />
      <rect x="5" y="10" width="6" height="2" />
    </g>
  </svg>
)

/** Folder with a `+` — new folder. */
export const NewFolderIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M1 3h5l2 2h7v9H1z" />
      <rect x="7" y="8" width="2" height="5" fill="var(--bg-elevated)" />
      <rect x="5.5" y="9.5" width="5" height="2" fill="var(--bg-elevated)" />
    </g>
  </svg>
)

/** Circular arrows — re-read the listing. */
export const RefreshIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 3v4H9l1.6-1.6A3 3 0 0 0 5 8z" />
      <path d="M13 8a5 5 0 0 1-8.5 3.5L3 13V9h4l-1.6 1.6A3 3 0 0 0 11 8z" />
    </g>
  </svg>
)
