/**
 * The printed document's palette (epic #1105).
 *
 * The app has two skins, but a PDF only ever has one: it is going onto paper,
 * or onto a white viewer background, so it takes the Soft Shell LIGHT tokens
 * (`index.css`, `:root[data-theme='skeuomorph']`) regardless of which skin the
 * editor is wearing. Printing the dark skin would waste ink and read worse.
 */

import { hexRgb, type Rgb } from './content'

/**
 * The page's own ground: WHITE (#1170).
 *
 * It was the app's warm parchment (`--panel`), which is right on a screen
 * beside the editor's own furniture and wrong on paper — a full-bleed tint on
 * every page of a printed handout costs ink, comes out a different colour from
 * every printer, and makes the board's own white sheet sit in the page like a
 * patch. The document keeps the Soft Shell INK and accents; only the ground
 * turns white.
 */
export const PAPER: Rgb = hexRgb('#ffffff')
/** The band behind every other table row, and panels that need to sit on the
 *  page — a whisper of the Soft Shell shell, enough to group rows by eye. */
export const PANEL: Rgb = hexRgb('#f4f1ea')
/** The listing's ground — a shade off white, so the code reads as a block. */
export const EDITOR: Rgb = hexRgb('#f7f4ec')
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
/** The gutter behind the listing's line numbers — `--gutter`, lightened for
 *  the white page so it reads as a margin rather than a stripe. */
export const GUTTER: Rgb = hexRgb('#efe9db')
