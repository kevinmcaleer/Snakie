/**
 * The printed document's palette (epic #1105).
 *
 * The app has two skins, but a PDF only ever has one: it is going onto paper,
 * or onto a white viewer background, so it takes the Soft Shell LIGHT tokens
 * (`index.css`, `:root[data-theme='skeuomorph']`) regardless of which skin the
 * editor is wearing. Printing the dark skin would waste ink and read worse.
 */

import { hexRgb, type Rgb } from './content'

/** Warm parchment, the page's own ground — Soft Shell `--panel`. */
export const PAPER: Rgb = hexRgb('#f6f1e6')
/** A shade deeper, for panels that need to sit on the parchment — `--shell`. */
export const PANEL: Rgb = hexRgb('#efe9dc')
/** The listing's ground — `--editor`. */
export const EDITOR: Rgb = hexRgb('#f4eede')
/** Hairlines and rules — `--shellbd`. */
export const RULE: Rgb = hexRgb('#e0d9c8')
/** Headings — `--head`. */
export const INK: Rgb = hexRgb('#2a2b28')
/** Secondary text — `--txt2`. */
export const INK_MUTED: Rgb = hexRgb('#5f5c50')
/** Soft Shell's green primary — `--accent-2`. */
export const GREEN: Rgb = hexRgb('#1c7a34')
/** Soft Shell's brass accent, dark enough to read as text — `--accent-ink`. */
export const BRASS: Rgb = hexRgb('#5c3f0c')
/** The brass at full strength, for rules and marks rather than text. */
export const BRASS_BRIGHT: Rgb = hexRgb('#b07d1e')
/** The gutter behind the listing's line numbers — `--gutter`. */
export const GUTTER: Rgb = hexRgb('#ece2cd')
