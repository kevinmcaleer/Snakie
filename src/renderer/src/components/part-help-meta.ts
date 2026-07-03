/**
 * Part help front-matter (#207) — pure parser for the optional YAML-ish header on
 * a part's bundled `help.md`, so the Help panel can surface a **detailed guide**
 * link (cross-linking to kevsrobots.com) and **open the example code** in a new
 * editor tab, separately from the article prose.
 *
 * The header is the usual `--- … ---` fence of simple `key: value` lines (no
 * nesting — kept minimal so the renderer needs no YAML dependency):
 *
 *     ---
 *     kevsrobots: https://www.kevsrobots.com/learn/parts/sg90/
 *     example: sg90_sweep.py
 *     ---
 *     # SG90 Servo
 *     …markdown…
 *
 * `kevsrobots` (or `guide`) → the external guide URL; `example` → the tab name to
 * use when opening the example. The example CODE is the first ```python block in
 * the body. Everything is optional and this never throws.
 */

export interface PartHelpMeta {
  /** External detailed-guide URL (e.g. kevsrobots.com), if declared. */
  guideUrl?: string
  /** The editor tab name for "Open example", if declared (else a default). */
  exampleName?: string
  /** The example code — the first python code block in the body, if any. */
  exampleCode?: string
  /** The help markdown with any front matter stripped (what the panel renders). */
  body: string
}

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/
const PY_BLOCK = /```(?:python|py)[ \t]*\r?\n([\s\S]*?)```/

/** Parse a part's help markdown into {@link PartHelpMeta}. Pure, never throws. */
export function parsePartHelp(helpText: string | undefined | null): PartHelpMeta {
  const src = helpText ?? ''
  const out: PartHelpMeta = { body: src }
  const fm = FRONT_MATTER.exec(src)
  if (fm) {
    out.body = src.slice(fm[0].length)
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^[ \t]*([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(line)
      if (!m) continue
      const key = m[1].toLowerCase()
      const val = m[2].replace(/^["']|["']$/g, '').trim()
      if (!val) continue
      if (key === 'kevsrobots' || key === 'guide') out.guideUrl = val
      else if (key === 'example') out.exampleName = val
    }
  }
  const code = PY_BLOCK.exec(out.body)
  if (code) {
    // Trim trailing whitespace per line + a single terminating newline.
    out.exampleCode = code[1].replace(/[ \t]+$/gm, '').replace(/\s+$/, '') + '\n'
  }
  return out
}

/** A safe default editor-tab name for a part's example (`<id>_example.py`). */
export function defaultExampleName(articleId: string): string {
  const id = articleId.replace(/^part-/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'part'
  return `${id}_example.py`
}
