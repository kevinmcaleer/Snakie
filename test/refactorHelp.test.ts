/**
 * The "Why?" articles behind every refactoring (epic #634 R7 / #807).
 *
 * The teaching payload is the whole point of this epic — the difference between
 * a linter that says *what* and a tutor that says *why*. A rule whose article is
 * missing still works, but its "Why?" button lands on a "not written yet"
 * placeholder, which is exactly the quiet rot this suite exists to prevent.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { ALL_RULES } from '../src/shared/refactor/rules'
import { HELP_SECTIONS, type HelpNode } from '../src/renderer/src/components/help-content'

const HELP_DIR = resolve(__dirname, '../src/renderer/src/components/help')

const articlePath = (id: string): string => resolve(HELP_DIR, `${id}.md`)

/** Every article id anywhere in the help tree. */
function treeArticleIds(nodes: readonly HelpNode[] = HELP_SECTIONS): Set<string> {
  const out = new Set<string>()
  const walk = (list: readonly HelpNode[]): void => {
    for (const node of list) {
      if (node.kind === 'article') out.add(node.id)
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

describe('refactoring help articles (#634 R7)', () => {
  it('every rule declares a "Why?" article', () => {
    expect(ALL_RULES.filter((r) => !r.helpArticle).map((r) => r.id)).toEqual([])
  })

  it('every declared article actually exists on disk', () => {
    const missing = ALL_RULES.filter((r) => !existsSync(articlePath(r.helpArticle))).map(
      (r) => `${r.id} -> ${r.helpArticle}.md`
    )
    expect(missing).toEqual([])
  })

  it('every article says something substantial, not a stub', () => {
    const thin: string[] = []
    for (const rule of ALL_RULES) {
      const body = readFileSync(articlePath(rule.helpArticle), 'utf8').trim()
      // A real explanation, not a restated title.
      if (body.length < 300) thin.push(`${rule.helpArticle} (${body.length} chars)`)
    }
    expect(thin).toEqual([])
  })

  it('shows the reader a before/after, which is how the point lands fastest', () => {
    const noExample = ALL_RULES.filter(
      (r) => !readFileSync(articlePath(r.helpArticle), 'utf8').includes('```')
    ).map((r) => r.helpArticle)
    expect(noExample).toEqual([])
  })

  it('keeps the implementation out of the reader\'s way', () => {
    // Prose written for the code should not leak into a page a learner reads.
    const leaks: string[] = []
    const banned = [
      /\bsafe: (true|false)\b/,
      /\bhintOnly\b/,
      /\bseverity: '/,
      /`apply`/,
      /`detect`/,
      /\{@link/,
      /\bctx\.[a-z]/i,
      /\bTextEdit\b/,
      /\bRefactorContext\b/,
      /\bepic #634\b/
    ]
    for (const rule of ALL_RULES) {
      const body = readFileSync(articlePath(rule.helpArticle), 'utf8')
      // Only prose counts; a code sample may legitimately show anything.
      const prose = body.replace(/```[\s\S]*?```/g, '')
      for (const pattern of banned) {
        if (pattern.test(prose)) leaks.push(`${rule.helpArticle}: ${pattern}`)
      }
    }
    expect(leaks).toEqual([])
  })

  it('lists every rule\'s article in the help contents, so the book is browsable', () => {
    const inTree = treeArticleIds()
    const orphans = ALL_RULES.filter((r) => !inTree.has(r.helpArticle)).map((r) => r.helpArticle)
    expect(orphans).toEqual([])
  })

  it('groups the articles by rule family under one Refactoring collection', () => {
    const book = HELP_SECTIONS.find((n) => n.id === 'refactoring')
    expect(book, 'the Refactoring collection should be in the contents').toBeTruthy()
    expect(book!.children?.length).toBeGreaterThan(0)
    // Every section is a family, and every family has at least one page.
    for (const section of book!.children ?? []) {
      expect(section.children?.length, `${section.id} should have pages`).toBeGreaterThan(0)
    }
  })

  it('has no duplicate article ids in the tree', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    const walk = (list: readonly HelpNode[]): void => {
      for (const node of list) {
        if (node.kind === 'article') {
          if (seen.has(node.id)) dupes.push(node.id)
          seen.add(node.id)
        }
        if (node.children) walk(node.children)
      }
    }
    walk(HELP_SECTIONS)
    expect(dupes).toEqual([])
  })
})
