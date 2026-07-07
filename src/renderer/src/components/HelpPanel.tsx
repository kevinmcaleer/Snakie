import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { Markdown } from './Markdown'
import {
  HELP_SECTIONS,
  DEFAULT_EXPANDED,
  detectProjectParts,
  type HelpNode,
  type ProjectPart
} from './help-content'
import { HELP_ARTICLES } from './help-articles'
import { parsePartHelp, defaultExampleName } from './part-help-meta'
import { ShelfIcon, TomeIcon, OpenBookIcon, ClosedBookIcon, PageIcon, CursorIcon } from './help-icons'
import { subscribeActiveEditor } from './editorBridge'
import { PARTS_CHANGED_EVENT } from './PartsPanel'
import { useWorkspace } from '../store/workspace'
import type { PartLibraryWithParts } from '../../../preload/index.d'
import './HelpPanel.css'

/**
 * HELP LIBRARY — a TechNet/`.chm`-style document tree for the Help side view.
 *
 * A parchment contents pane: a brass header plate, a search field, then a
 * collapsible, indented tree of book-family nodes (shelf → tome → open/closed
 * book → page). Two evergreen sections (Getting Started, Reference) plus the
 * Instruments articles (opened by each instrument's `?`), and a project-aware
 * **In This Project** section built from the active file's hardware usage — with
 * a **live** dot per part and an **at cursor** badge on the part under the caret.
 *
 * Selecting a page switches the panel to the rendered article (sanitised markdown
 * from {@link ./help-articles}, or a placed part's bundled help). `target` (from
 * an instrument's `?`, via AppShell) opens a specific article.
 */
export function HelpPanel({ target }: { target?: { id: string; nonce: number } }): JSX.Element {
  const { openFiles, activeId, openBuffer, currentFolder } = useWorkspace()
  const source = openFiles.find((f) => f.id === activeId)?.content ?? ''

  // Parts PLACED on the board (robot.yml) — so the "In This Project" section
  // (and the embedded Board mode's routed part help, modes review) covers parts
  // that are wired but not imported yet. Refreshes on cross-window edits.
  const [placedParts, setPlacedParts] = useState<{ lib: string; part: string }[]>([])
  useEffect(() => {
    let live = true
    const load = (): void => {
      window.api.robot
        .load(currentFolder ?? undefined)
        .then((r) => {
          if (live) setPlacedParts((r.parts ?? []).map((p) => ({ lib: p.lib, part: p.part })))
        })
        .catch(() => undefined)
    }
    load()
    const off = window.api.robot.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [currentFolder])

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(DEFAULT_EXPANDED))
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>([])
  const [cursorLine, setCursorLine] = useState('')

  // Installed libraries (for the part-aware section); refresh on save.
  useEffect(() => {
    const load = (): void => {
      window.api.parts.listLibraries().then(setLibraries).catch(() => setLibraries([]))
    }
    load()
    window.addEventListener(PARTS_CHANGED_EVENT, load)
    return () => window.removeEventListener(PARTS_CHANGED_EVENT, load)
  }, [])

  // Track the editor caret's line text so the part under the cursor is tagged.
  useEffect(() => {
    let offCursor = (): void => {}
    const off = subscribeActiveEditor((editor) => {
      offCursor()
      if (!editor) {
        setCursorLine('')
        return
      }
      const read = (): void => {
        const pos = editor.getPosition()
        setCursorLine(pos ? editor.getModel()?.getLineContent(pos.lineNumber) ?? '' : '')
      }
      read()
      const d = editor.onDidChangeCursorPosition(read)
      offCursor = () => d.dispose()
    })
    return () => {
      offCursor()
      off()
    }
  }, [])

  // Open a specific article when an instrument's `?` (or a deep link) requests it.
  useEffect(() => {
    if (target?.id) setSelected(target.id)
  }, [target?.nonce, target?.id])

  // The project-aware "In This Project" parts + a lookup for their bundled help.
  const projectParts = useMemo<ProjectPart[]>(
    () => detectProjectParts(source, libraries, cursorLine, placedParts),
    [source, libraries, cursorLine, placedParts]
  )
  const partHelp = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projectParts) m.set(p.articleId, p.part.helpText ?? '')
    return m
  }, [projectParts])

  // The full tree = the dynamic project section (when any) + the evergreen ones.
  const tree = useMemo<HelpNode[]>(() => {
    const roots = [...HELP_SECTIONS]
    if (projectParts.length > 0) {
      roots.unshift({
        id: 'in-this-project',
        kind: 'section',
        title: 'In This Project',
        accent: '#2f7c70',
        meta: `live · ${projectParts.length}`,
        children: projectParts.map((p) => ({
          id: p.articleId,
          kind: 'article' as const,
          title: p.name,
          meta: p.meta,
          accent: p.accent,
          live: p.live,
          atCursor: p.atCursor
        }))
      })
    }
    return roots
  }, [projectParts])

  // Highlight the at-cursor part (doesn't force its article open).
  const cursorPart = projectParts.find((p) => p.atCursor)

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const q = query.trim().toLowerCase()
  const matches = useCallback(
    (node: HelpNode): boolean => {
      if (!q) return true
      if (node.title.toLowerCase().includes(q)) return true
      return (node.children ?? []).some(matches)
    },
    [q]
  )

  const renderNode = (node: HelpNode, depth: number): JSX.Element | null => {
    if (q && !matches(node)) return null
    const isBranch = node.kind !== 'article'
    const open = isBranch && (q ? true : expanded.has(node.id))
    const icon =
      node.kind === 'collection' ? (
        <TomeIcon />
      ) : node.kind === 'section' ? (
        open ? (
          <OpenBookIcon />
        ) : (
          <ClosedBookIcon />
        )
      ) : (
        <PageIcon />
      )
    const isSel = selected === node.id || (!selected && cursorPart?.articleId === node.id)
    const row = (
      <div
        className={`help-tree__row ${isBranch ? 'help-tree__row--branch' : 'help-tree__row--leaf'}${
          isSel ? ' is-selected' : ''
        }`}
        role="treeitem"
        aria-expanded={isBranch ? open : undefined}
        aria-selected={isSel}
        onClick={() => (isBranch ? toggle(node.id) : setSelected(node.id))}
      >
        {depth > 0 && <span className="help-tree__stub" aria-hidden="true" />}
        {isBranch ? (
          <button
            type="button"
            className="help-tree__toggle"
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.id)
            }}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '−' : '+'}
          </button>
        ) : (
          <span className="help-tree__spacer" aria-hidden="true" />
        )}
        <span className="help-tree__icon" style={{ color: node.accent }} aria-hidden="true">
          {icon}
        </span>
        <span className={`help-tree__label help-tree__label--${node.kind}`}>{node.title}</span>
        {node.meta && node.kind === 'article' && <span className="help-tree__meta">{node.meta}</span>}
        {node.meta && isBranch && <span className="help-tree__count">{node.meta}</span>}
        {node.live && <span className="help-tree__dot" title="Wired into the running project" aria-hidden="true" />}
        {node.atCursor && (
          <span className="help-tree__atcursor" title="Under the cursor">
            <CursorIcon size={9} /> at cursor
          </span>
        )}
      </div>
    )
    if (!isBranch) return <div key={node.id}>{row}</div>
    return (
      <div key={node.id}>
        {row}
        {open && node.children && (
          <div className="help-tree__children">{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    )
  }

  // --- Article view -------------------------------------------------------
  if (selected) {
    const title = articleTitle(tree, selected) ?? 'Help'
    // A PART article carries optional front matter (#207): a kevsrobots.com guide
    // link + an example we can open in a new editor tab. Built-in articles render
    // verbatim.
    const isPart = partHelp.has(selected)
    const meta = isPart ? parsePartHelp(partHelp.get(selected) ?? '') : null
    const body = meta ? meta.body : (HELP_ARTICLES[selected] ?? '')
    const showActions = meta && (meta.guideUrl || meta.exampleCode)
    return (
      <div className="help">
        <div className="help__plate">
          <button type="button" className="help__back" onClick={() => setSelected(null)} title="Back to contents">
            ‹
          </button>
          <span className="help__plate-title">{title}</span>
          <span className="help__plate-caption">Article</span>
        </div>
        <div className="help__article">
          {showActions && (
            <div className="help__part-actions">
              {meta?.guideUrl && (
                <button
                  type="button"
                  className="help__guide"
                  onClick={() => void window.api?.openExternal?.(meta.guideUrl as string).catch(() => undefined)}
                  title={meta.guideUrl}
                >
                  📖 Full guide on kevsrobots.com →
                </button>
              )}
              {meta?.exampleCode && (
                <button
                  type="button"
                  className="help__example"
                  onClick={() =>
                    openBuffer(meta.exampleName || defaultExampleName(selected), meta.exampleCode as string)
                  }
                  title="Open this part's example in a new editor tab"
                >
                  ⧉ Open example in editor
                </button>
              )}
            </div>
          )}
          {body ? <Markdown source={body} /> : <p className="help__empty">No help written for this page yet.</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="help">
      <div className="help__plate">
        <span className="help__plate-icon" aria-hidden="true">
          <ShelfIcon />
        </span>
        <span className="help__plate-title">HELP LIBRARY</span>
        <span className="help__plate-caption">Contents</span>
      </div>
      <div className="help__search">
        <span className="help__search-mag" aria-hidden="true">
          ⌕
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the library…"
          aria-label="Search the help library"
        />
      </div>
      <div className="help-tree" role="tree" aria-label="Help contents">
        {tree.map((n) => renderNode(n, 0))}
      </div>
      <div className="help__legend" aria-hidden="true">
        <span className="help__legend-item" style={{ color: '#b8892b' }}>
          <ShelfIcon size={13} /> library
        </span>
        <span className="help__legend-item" style={{ color: '#b58a2e' }}>
          <TomeIcon size={13} /> collection
        </span>
        <span className="help__legend-item" style={{ color: '#37884a' }}>
          <OpenBookIcon size={13} /> open
        </span>
        <span className="help__legend-item" style={{ color: '#8b5fc0' }}>
          <ClosedBookIcon size={13} /> closed
        </span>
        <span className="help__legend-item" style={{ color: '#8a7f62' }}>
          <PageIcon size={13} /> article
        </span>
      </div>
    </div>
  )
}

/** Depth-first search for an article node's title. */
function articleTitle(nodes: HelpNode[], id: string): string | undefined {
  for (const n of nodes) {
    if (n.id === id) return n.title
    const found = n.children ? articleTitle(n.children, id) : undefined
    if (found) return found
  }
  return undefined
}
