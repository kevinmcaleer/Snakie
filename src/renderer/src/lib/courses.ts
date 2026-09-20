/**
 * Bundled tutorial COURSES for the Projects gallery + tutorial dialog (#479).
 * =============================================================================
 *
 * Each course is a folder under `src/renderer/src/courses/<id>/` with a
 * `course.yml` (the kevsrobots-style structure) + one Markdown file per lesson.
 * They're inlined at build time via Vite `?raw` globs (so both the web and the
 * Electron build ship them, no server), parsed here into {@link Course}s.
 *
 * A lesson can carry starter `code` (seeds the editor when you open the lesson)
 * and a `tip` (a lightbulb popup). Thumbnails are an emoji + accent colour, so no
 * image assets need authoring.
 */
import { parse } from 'yaml'
import type { BlocksViewMode, WorkspaceId } from '../store/layout'
import type { BlockLevel } from './blocks/registry'

export interface Lesson {
  title: string
  /** Rendered Markdown body (resolved from the lesson's `file`). */
  body: string
  /** Optional starter code — opened in the editor when the lesson opens. */
  code?: string
  /** Optional tip shown behind the lightbulb (Markdown). */
  tip?: string
  /**
   * The workspace this lesson is about (#483). A lesson on wiring belongs in
   * Electronics and one on URDF joints in Build; opening either in the code
   * editor leaves the reader to find the view the words are describing.
   *
   * Absent ⇒ don't switch. Staying put is the safe default: a lesson that says
   * nothing about where it lives has no business moving the user.
   */
  view?: WorkspaceId
  /**
   * A starter BLOCKS workspace (#1016), as Blockly's own serialisation.
   *
   * Beside `code`, not instead of it: a lesson in the blocks track hands over a
   * canvas, and the last lesson of that track hands over the same program as
   * text. When both are present the blocks win — a blocks lesson opened as a
   * plain `.py` would be a lesson about blocks with no blocks in it.
   */
  blocks?: unknown
  /**
   * Which side of a blocks file the lesson wants big: `blocks`, `split` or
   * `python`.
   *
   * The visual form of the handover. The last lesson of the blocks track is
   * "the same program, in Python", and it should OPEN Python-primary with the
   * canvas still peeking beside it — the layout saying what the words say.
   */
  viewMode?: BlocksViewMode
  /**
   * The blocks LEVEL this lesson needs (#1214).
   *
   * A lesson built out of advanced blocks — the grey Python escape hatch,
   * classes, comprehensions — cannot be followed by a learner whose toolbox is
   * filtered to `simple`: the drawer the words point at is not there. So the
   * lesson says so, and opening it raises `snakie.blocks.level`.
   *
   * Only ever a RAISE, never a lowering: leaving the lesson does not put the
   * drawers away again (they have now seen them), and a beginner course that
   * declares nothing never turns advanced blocks on.
   */
  level?: BlockLevel
}

export type CourseTrack = 'beginner' | 'robotics' | 'urdf'

export interface Course {
  id: string
  title: string
  description: string
  emoji: string
  accent: string
  track: CourseTrack
  /**
   * The blocks level the course as a whole needs (#1214) — inherited by every
   * lesson that doesn't declare its own. Absent ⇒ `simple`, i.e. nothing.
   */
  level?: BlockLevel
  lessons: Lesson[]
}

interface RawLesson {
  title: string
  file: string
  code?: string
  tip?: string
  view?: string
  blocks?: unknown
  viewMode?: string
  level?: string
}
interface RawCourse {
  title: string
  description: string
  emoji?: string
  accent?: string
  track?: CourseTrack
  level?: string
  lessons: RawLesson[]
}

// Inlined at build time. Keys are absolute-from-root module paths.
const courseYml = import.meta.glob('../courses/*/course.yml', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>
const lessonMd = import.meta.glob('../courses/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/**
 * A lesson's declared workspace, or `undefined` when absent/unknown.
 *
 * Course YAML is authored by hand, so a typo (`board-view`, `Electronics`) must
 * degrade to "don't switch" rather than throwing the whole course away. The
 * friendly aliases are accepted because the UI calls these workspaces
 * Code / Electronics / Build while the layout ids are `code`/`board`/`robot`.
 */
export function coerceView(raw: unknown): WorkspaceId | undefined {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return undefined
  const alias: Record<string, WorkspaceId> = {
    // `blocks` is a workspace too since #1009, and a lesson in the blocks track
    // has every reason to ask for it.
    blocks: 'blocks',
    canvas: 'blocks',
    code: 'code',
    editor: 'code',
    board: 'board',
    electronics: 'board',
    breadboard: 'board',
    robot: 'robot',
    build: 'robot',
    urdf: 'robot',
    '3d': 'robot'
  }
  return alias[v]
}

/**
 * A lesson's blocks starter, or `undefined` when it has none or it is malformed.
 *
 * Course YAML is authored by hand, so a workspace that isn't one must degrade to
 * "this lesson has no blocks" rather than reaching the canvas and throwing
 * inside Blockly's deserialiser — which #1009 established is the failure that
 * can lose a program.
 */
export function coerceBlocks(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const blocks = (raw as { blocks?: unknown }).blocks
  if (!blocks || typeof blocks !== 'object') return undefined
  return raw
}

/**
 * A lesson's requested blocks emphasis, or `undefined`.
 *
 * `undefined` means "use the workspace default", which since #1016 is the split
 * — so a lesson has to ASK to be Python-primary, and only the handover lesson
 * does.
 */
export function coerceViewMode(raw: unknown): BlocksViewMode | undefined {
  const v = String(raw ?? '').trim().toLowerCase()
  const modes: Record<string, BlocksViewMode> = {
    blocks: 'blocks',
    canvas: 'blocks',
    split: 'split',
    both: 'split',
    python: 'python',
    code: 'python'
  }
  return modes[v]
}

/**
 * A declared blocks level, or `undefined` when absent/unknown (#1214).
 *
 * `simple` is accepted and meaningful as "this course is explicitly a beginner
 * one" — but it is never applied as a change, because the flip only ever goes
 * upwards. A typo degrades to "declares nothing", like every other hand-authored
 * key here: a misspelt level must not throw the course away.
 */
export function coerceLevel(raw: unknown): BlockLevel | undefined {
  const v = String(raw ?? '').trim().toLowerCase()
  const levels: Record<string, BlockLevel> = {
    simple: 'simple',
    beginner: 'simple',
    basic: 'simple',
    advanced: 'advanced',
    expert: 'advanced'
  }
  return levels[v]
}

/**
 * The level a lesson effectively asks for: its own, else its course's (#1214).
 */
export function lessonLevel(course: Course, lesson: Lesson): BlockLevel | undefined {
  return lesson.level ?? course.level
}

/**
 * Should opening this lesson raise the learner's block level? Pure (#1214).
 *
 * The whole rule in one place, because the rule is the feature: raise when the
 * lesson asks for `advanced` and the learner is on `simple`. Never the other
 * way round — a course cannot take drawers away from someone who has chosen to
 * have them, and leaving the lesson does not undo the raise.
 */
export function shouldRaiseBlockLevel(
  declared: BlockLevel | undefined,
  current: BlockLevel
): boolean {
  return declared === 'advanced' && current === 'simple'
}

/** `../courses/<id>/course.yml` → `<id>`. */
const idOf = (path: string): string => path.replace(/.*\/courses\/([^/]+)\/.*/, '$1')

let cache: Course[] | null = null

/** All bundled courses, in track order (beginner → robotics → urdf), parsed once. */
export function loadCourses(): Course[] {
  if (cache) return cache
  const out: Course[] = []
  for (const [ymlPath, yml] of Object.entries(courseYml)) {
    const id = idOf(ymlPath)
    let raw: RawCourse
    try {
      raw = parse(yml) as RawCourse
    } catch {
      continue
    }
    if (!raw || !Array.isArray(raw.lessons)) continue
    const dir = ymlPath.slice(0, ymlPath.lastIndexOf('/'))
    const lessons: Lesson[] = raw.lessons
      .map((l): Lesson | null => {
        const body = lessonMd[`${dir}/${l.file}`]
        if (body == null) return null
        return {
          title: l.title,
          body,
          code: l.code,
          tip: l.tip,
          view: coerceView(l.view),
          level: coerceLevel(l.level),
          blocks: coerceBlocks(l.blocks),
          viewMode: coerceViewMode(l.viewMode)
        }
      })
      .filter((l): l is Lesson => l !== null)
    if (!lessons.length) continue
    out.push({
      id,
      title: raw.title ?? id,
      description: raw.description ?? '',
      emoji: raw.emoji ?? '📘',
      accent: raw.accent ?? '#34ad4f',
      track: raw.track ?? 'beginner',
      level: coerceLevel(raw.level),
      lessons
    })
  }
  const order: CourseTrack[] = ['beginner', 'robotics', 'urdf']
  return (cache = out.sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track) || a.title.localeCompare(b.title)))
}
