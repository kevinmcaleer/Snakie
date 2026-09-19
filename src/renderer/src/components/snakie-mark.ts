/**
 * THE SNAKIE MARK, in one place (#1109).
 *
 * The toolbar draws it as JSX and the PDF export's cover rasterises it from a
 * standalone SVG string. Those are two renderers, so the ARTWORK is the shared
 * thing: the body markup below is the single source, and both sides wrap it in
 * their own `<svg>`.
 *
 * Kept as markup rather than a file import because the app icon in `build/` is
 * packaging input, outside the renderer's bundle, and a 1024×1024 icon is the
 * wrong thing to shrink into a 28px toolbar button anyway.
 */

/** The mark's coordinate system. */
export const SNAKIE_MARK_VIEWBOX = '0 0 32 32'

/**
 * The mark's contents — everything INSIDE the `<svg>`.
 *
 * A module constant, never user input: the toolbar injects it with
 * `dangerouslySetInnerHTML` precisely because there is nothing dangerous in it,
 * and the alternative is a second copy that drifts.
 */
export const SNAKIE_MARK_BODY =
  '<defs>' +
  '<linearGradient id="snakie-mark" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#86df6f"></stop>' +
  '<stop offset="1" stop-color="#369b2c"></stop>' +
  '</linearGradient>' +
  '</defs>' +
  '<path d="M10 27c0-4 6-3.5 6-8s-6-3.5-6-8 5.5-5 10-3.6" fill="none" ' +
  'stroke="url(#snakie-mark)" stroke-width="4.3" stroke-linecap="round"></path>' +
  '<circle cx="21" cy="7" r="3.7" fill="url(#snakie-mark)" stroke="#2f7a28" stroke-width="0.7"></circle>' +
  '<circle cx="22.1" cy="6.3" r="0.95" fill="#16240f"></circle>' +
  '<path d="M24.4 8l3 .7m-3-.7l3-.9" stroke="#e23b2b" stroke-width="1.1" stroke-linecap="round"></path>'

/** The mark as a standalone SVG document, for rasterising into the PDF cover. */
export function snakieMarkSvg(size = 256, background?: string): string {
  const bg = background
    ? `<rect x="0" y="0" width="32" height="32" fill="${background}"></rect>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="${SNAKIE_MARK_VIEWBOX}">${bg}${SNAKIE_MARK_BODY}</svg>`
  )
}
