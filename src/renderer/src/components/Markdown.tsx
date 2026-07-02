import { useMemo, type JSX } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import './Markdown.css'

/**
 * Render plain **markdown** as sanitised HTML. Used by the part mini-help viewer
 * (the Board View help drawer), the Part Editor's help preview, and the Help
 * Library articles.
 *
 * Bundled part help is authored by the user / the build-part-from-image skill and
 * community parts are cloned verbatim, so the markdown is UNTRUSTED — every render
 * is piped through DOMPurify. Links are left in the output but open in the user's
 * real browser via `window.api.openExternal` (a click handler on the container),
 * never navigating the Electron renderer. Each code block gets a hover **copy**
 * button (added AFTER sanitising, so the trusted button markup is preserved).
 */

/** The copy/check button injected into every `<pre>` (trusted, post-sanitise). */
const COPY_BUTTON =
  '<button type="button" class="md-copy" title="Copy code" aria-label="Copy code">' +
  '<svg class="md-copy-i" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
  '<svg class="md-copy-ok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>' +
  '</button>'

export function Markdown({ source, className }: { source: string; className?: string }): JSX.Element {
  const html = useMemo(() => {
    const raw = marked.parse(source ?? '', { async: false, gfm: true, breaks: true }) as string
    const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
    // Wrap each code block in a positioned container + a copy button.
    return clean
      .replace(/<pre>/g, `<div class="md-code">${COPY_BUTTON}<pre>`)
      .replace(/<\/pre>/g, '</pre></div>')
  }, [source])

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = e.target as HTMLElement
    // Copy button → copy the sibling <pre>'s text.
    const copy = el.closest?.('.md-copy') as HTMLButtonElement | null
    if (copy) {
      e.preventDefault()
      const code = copy.parentElement?.querySelector('pre')?.textContent ?? ''
      void navigator.clipboard
        ?.writeText(code)
        .then(() => {
          copy.classList.add('is-copied')
          window.setTimeout(() => copy.classList.remove('is-copied'), 1400)
        })
        .catch(() => undefined)
      return
    }
    // External links open in the real browser, not the renderer.
    const a = el.closest?.('a') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault()
      void window.api?.openExternal?.(href).catch(() => undefined)
    }
  }

  return (
    <div
      className={`md${className ? ` ${className}` : ''}`}
      onClick={onClick}
      // Sanitised above; the injected copy button is trusted, added post-sanitise.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
