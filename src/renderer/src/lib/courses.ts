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

export interface Lesson {
  title: string
  /** Rendered Markdown body (resolved from the lesson's `file`). */
  body: string
  /** Optional starter code — opened in the editor when the lesson opens. */
  code?: string
  /** Optional tip shown behind the lightbulb (Markdown). */
  tip?: string
}

export type CourseTrack = 'beginner' | 'robotics' | 'urdf'

export interface Course {
  id: string
  title: string
  description: string
  emoji: string
  accent: string
  track: CourseTrack
  lessons: Lesson[]
}

interface RawLesson {
  title: string
  file: string
  code?: string
  tip?: string
}
interface RawCourse {
  title: string
  description: string
  emoji?: string
  accent?: string
  track?: CourseTrack
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
        return { title: l.title, body, code: l.code, tip: l.tip }
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
      lessons
    })
  }
  const order: CourseTrack[] = ['beginner', 'robotics', 'urdf']
  return (cache = out.sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track) || a.title.localeCompare(b.title)))
}
