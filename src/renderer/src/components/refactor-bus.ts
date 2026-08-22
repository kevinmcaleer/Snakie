/**
 * The seam between the refactoring engine and the preview modal (#634 §2.4).
 *
 * A refactoring never touches the file until the user has seen a diff of what
 * it will do — that is one of the epic's acceptance criteria, and the reason is
 * trust: this feature rewrites people's working robot code. The Monaco code
 * action computes the rewrite, hands it to this bus, and the React modal
 * (`RefactorPreview`) renders the diff and calls back on Apply.
 *
 * The one exception is a rule the user has explicitly ticked "don't ask again"
 * for; those preferences live in localStorage, per rule id.
 */

/** DOM event carrying a proposed rewrite to the preview modal. */
export const REFACTOR_PREVIEW_EVENT = 'snakie:refactor-preview'

/** Everything the modal needs to show a rewrite and let the user accept it. */
export interface RefactorPreviewDetail {
  ruleId: string
  /** Menu-level label, e.g. 'Convert to guard clause'. */
  title: string
  /** One-line explanation of the smell. */
  message: string
  /** The "Why?" help article id (#221 help system). */
  helpArticle: string
  /** File contents before and after, for the diff. */
  before: string
  after: string
  /** False for rewrites that trade safety, RAM or portability for speed. */
  safe: boolean
  /** How many separate places in the file this changes. */
  editCount: number
  /** Commit the rewrite to the editor (single undo step). */
  onApply: () => void
}

/** Ask the preview modal to show a rewrite. */
export function dispatchRefactorPreview(detail: RefactorPreviewDetail): void {
  window.dispatchEvent(new CustomEvent<RefactorPreviewDetail>(REFACTOR_PREVIEW_EVENT, { detail }))
}

const SUPPRESS_KEY = 'snakie.refactor.skipPreview'

/** Rule ids the user has ticked "don't ask again" for. */
function suppressedIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SUPPRESS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch {
    // A private window or blocked storage just means we always preview, which
    // is the safe default anyway.
    return new Set()
  }
}

/** Has the user asked to skip the preview for this rule? */
export function isPreviewSuppressed(ruleId: string): boolean {
  return suppressedIds().has(ruleId)
}

/** Remember that this rule should apply without a preview from now on. */
export function suppressPreview(ruleId: string): void {
  try {
    const ids = suppressedIds()
    ids.add(ruleId)
    window.localStorage.setItem(SUPPRESS_KEY, JSON.stringify([...ids]))
  } catch {
    /* best effort — the preview simply keeps appearing */
  }
}

/** Show previews for every rule again (offered in Settings). */
export function clearSuppressedPreviews(): void {
  try {
    window.localStorage.removeItem(SUPPRESS_KEY)
  } catch {
    /* best effort */
  }
}
