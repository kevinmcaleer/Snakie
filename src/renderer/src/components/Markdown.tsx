import { useMemo, type JSX } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import './Markdown.css'

/**
 * Render plain **markdown** as sanitised HTML. Used by the part mini-help viewer
 * (the Board View help drawer) and the Part Editor's help preview.
 *
 * Bundled part help is authored by the user / the build-part-from-image skill and
 * community parts are cloned verbatim, so the markdown is UNTRUSTED — every render
 * is piped through DOMPurify. Links are left in the output but open in the user's
 * real browser via `window.api.openExternal` (a click handler on the container),
 * never navigating the Electron renderer.
 */
export function Markdown({ source, className }: { source: string; className?: string }): JSX.Element {
  const html = useMemo(() => {
    const raw = marked.parse(source ?? '', { async: false, gfm: true, breaks: true }) as string
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
  }, [source])

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null
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
      // Sanitised above; safe to inject.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
