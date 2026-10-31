/**
 * `url("#id")` → `url(#id)`. Computed styles quote their references, and a
 * host's SVG cleaner may drop any style with a quoted `url(` in it (kevsrobots'
 * `svg_safety` did): the blueprint paper then lost its blend and covered the
 * whole sheet in grey noise. Unquoted, a fragment reference reads the same.
 */
export function unquoteUrls(value: string): string {
  return value.replace(/url\(\s*(["'])\s*(#[^"')]*)\1\s*\)/g, 'url($2)')
}
