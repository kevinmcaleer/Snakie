/**
 * COURSE LINK CONTRACT (#483) — the shareable URL for a tutorial entry point.
 * =============================================================================
 *
 * A course you are halfway through is worth sending to someone: "start here".
 * The link lives in the URL **hash**, not the path or the query, for two reasons:
 * it survives the web app's static hosting with no server route to add, and
 * changing it never reloads the page — so restoring a course is a state change
 * rather than a boot.
 *
 *   #/learn/<courseId>              the course, at its splash
 *   #/learn/<courseId>/<lessonNo>   a specific lesson, 1-based
 *
 * Lessons are **1-based in the URL** and 0-based in the store: a link that reads
 * `/3` should be the third lesson, not the fourth. The conversion happens here,
 * once, so nothing downstream has to remember it.
 *
 * Pure and DOM-free — the parsing/formatting is unit-tested without a browser,
 * and the tiny amount of `location`/`history` work lives in the caller.
 */

/** A parsed course entry point. `lessonIndex` is 0-based, or `null` for "splash". */
export interface CourseLink {
  courseId: string
  lessonIndex: number | null
}

const PREFIX = '#/learn/'

/**
 * Parse a location hash into a course entry point, or `null` when it isn't one.
 *
 * Deliberately forgiving about the things that differ between "a URL someone
 * pasted" and "a URL we wrote" — a missing leading `#`, a trailing slash, percent
 * encoding — and strict about the things that would send the user somewhere
 * wrong: a non-numeric or non-positive lesson yields the course's splash rather
 * than a guessed lesson.
 */
export function parseCourseLink(hash: string | null | undefined): CourseLink | null {
  if (!hash) return null
  const raw = hash.startsWith('#') ? hash : `#${hash}`
  if (!raw.toLowerCase().startsWith(PREFIX)) return null
  const rest = raw.slice(PREFIX.length).replace(/\/+$/, '')
  if (!rest) return null
  const [idPart, lessonPart, ...extra] = rest.split('/')
  // A deeper path is not a link we wrote; refusing beats guessing which segment
  // was meant to be the lesson.
  if (extra.length > 0) return null
  let courseId: string
  try {
    courseId = decodeURIComponent(idPart)
  } catch {
    courseId = idPart // a lone `%` is not worth discarding the whole link over
  }
  courseId = courseId.trim()
  if (!courseId) return null
  if (lessonPart === undefined || lessonPart === '') return { courseId, lessonIndex: null }
  // `Number` so `3x` is rejected rather than silently read as 3 (parseInt would).
  const n = Number(lessonPart)
  if (!Number.isInteger(n) || n < 1) return { courseId, lessonIndex: null }
  return { courseId, lessonIndex: n - 1 }
}

/** Build the hash for a course entry point. `lessonIndex` is 0-based. */
export function formatCourseLink(courseId: string, lessonIndex?: number | null): string {
  const id = encodeURIComponent(String(courseId ?? '').trim())
  if (!id) return ''
  if (lessonIndex === null || lessonIndex === undefined || lessonIndex < 0) return `${PREFIX}${id}`
  return `${PREFIX}${id}/${Math.floor(lessonIndex) + 1}`
}

/**
 * Clamp a parsed link against the course that was actually found.
 *
 * An out-of-range lesson — a link to lesson 9 of a course that has since lost
 * lessons — opens the LAST lesson rather than failing: the user asked for this
 * course, and showing them the end of it beats an error page. `null` when the
 * course has no lessons at all.
 */
export function resolveLessonIndex(link: CourseLink, lessonCount: number): number | null {
  if (link.lessonIndex === null) return null
  if (lessonCount <= 0) return null
  return Math.min(link.lessonIndex, lessonCount - 1)
}
