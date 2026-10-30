import type { Plugin as PostcssPlugin, Rule } from 'postcss'

/**
 * SCOPE THE EMBED'S CSS — snakie#1277.
 * =============================================================================
 *
 * The embeddable bundle (vite.embed.config.ts) ships Snakie's own stylesheets —
 * the Soft Shell tokens on `:root`, `body` resets, component classes like `.btn`
 * — into somebody else's page. Unscoped, they would restyle the host (kevsrobots
 * uses Bootstrap's `.btn`) and the host's would restyle them.
 *
 * This PostCSS plugin rewrites every selector to live under `.snakie-embed`, the
 * element each mount draws into: `:root`, `html` and `body` BECOME it (so the
 * tokens and the `data-theme` skins land on the embed root, and a host can
 * override a token on its own `.snakie-embed` rule), and everything else is
 * prefixed. `@font-face` and keyframes are left alone — they are global by
 * nature and named distinctly.
 */
export const EMBED_SCOPE = '.snakie-embed'

/** One selector, scoped. Exported for tests. */
export function scopeSelector(selector: string, scope = EMBED_SCOPE): string {
  const s = selector.trim()
  if (!s || s.startsWith(scope)) return s
  // :root / html / body (with whatever follows on the same compound) → the scope.
  const root = /^(?::root|html|body)(?![\w-])/
  if (root.test(s)) {
    const rest = s.replace(root, '')
    // `html body .x` → `.snakie-embed .x`
    return (scope + rest.replace(/^\s+(?:body|html)(?![\w-])/, '')).replace(/\s+/g, ' ')
  }
  if (s === '*' || s.startsWith('*') || s.startsWith('::')) return `${scope} ${s}`
  return `${scope} ${s}`
}

function insideKeyframes(rule: Rule): boolean {
  let p = rule.parent
  while (p) {
    if (p.type === 'atrule' && /keyframes$/i.test((p as { name: string }).name)) return true
    p = p.parent as typeof p
  }
  return false
}

export function embedScope(scope = EMBED_SCOPE): PostcssPlugin {
  return {
    postcssPlugin: 'snakie-embed-scope',
    Rule(rule) {
      if (insideKeyframes(rule)) return
      // Selectors already scoped (embed.css) and the visited marker are skipped.
      if ((rule as Rule & { __scoped?: boolean }).__scoped) return
      rule.selectors = rule.selectors.map((sel) => scopeSelector(sel, scope))
      ;(rule as Rule & { __scoped?: boolean }).__scoped = true
    }
  }
}
