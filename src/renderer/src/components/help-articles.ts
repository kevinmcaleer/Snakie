/**
 * Help article bodies (markdown), loaded from the `.md` files in `./help` at build
 * time (Vite `?raw` glob). Each file's name (minus `.md`) is its article **id**,
 * matching the tree ids in {@link ./help-content}. Rendered by the sanitised
 * {@link ./Markdown} component.
 *
 * To add or edit a page, just drop / edit `./help/<id>.md` — no code change. A
 * missing id falls back to a "not written yet" placeholder in the panel.
 */
const modules = import.meta.glob('./help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

export const HELP_ARTICLES: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, md]) => [path.slice(path.lastIndexOf('/') + 1, -3), md])
)
