/**
 * CONFLICT-SAFE LESSON SEEDING (#483).
 * =============================================================================
 *
 * Opening a lesson drops its starter code into the editor. That is fine the first
 * time and destructive the second: step away from lesson 3, change the code,
 * come back, and the naive version overwrites what you wrote — the one thing the
 * issue's acceptance criteria call out ("existing user files are preserved or the
 * user explicitly approves replacement").
 *
 * The decision is pure so every branch is testable without an editor:
 *
 *  - `open`    — nothing there yet, or the buffer is byte-identical to the
 *                starter. Just open it; there is nothing to lose.
 *  - `keep`    — the user's copy differs, and they have already been asked about
 *                THIS lesson. Re-prompting on every revisit is its own kind of
 *                data loss (the one that trains people to click through dialogs).
 *  - `confirm` — the user's copy differs and they haven't decided. Ask.
 *
 * "Asked already" is remembered per lesson rather than globally, so approving a
 * reset on one lesson never silently resets another.
 */

/** What the caller should do with a lesson's starter code. */
export type SeedAction = 'open' | 'keep' | 'confirm'

export interface SeedInput {
  /** The starter code the lesson wants to place. Empty/absent ⇒ nothing to do. */
  starter?: string
  /** The current contents of the target buffer, or `null` if it isn't open. */
  existing?: string | null
  /** Has the user already answered a prompt for THIS lesson this session? */
  asked?: boolean
}

/**
 * Decide how to seed a lesson's starter code. Pure.
 *
 * Whitespace-only differences count as "the same": a trailing newline the editor
 * added is not the user's work, and prompting over it would make the safeguard
 * feel broken rather than careful.
 */
export function seedAction({ starter, existing, asked }: SeedInput): SeedAction {
  if (!starter) return 'keep' // nothing to place
  if (existing === null || existing === undefined) return 'open'
  if (normalise(existing) === normalise(starter)) return 'open'
  return asked ? 'keep' : 'confirm'
}

/** Trailing whitespace per line + at the end: editor noise, not user intent. */
function normalise(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

/** The buffer name a lesson's starter code is opened as. Stable across a
 *  session so revisiting a lesson targets the same buffer rather than piling up
 *  `course-01.py`, `course-01 (2).py`, … */
export function lessonFileName(courseId: string, lessonIndex: number): string {
  return `${courseId}-${String(Math.max(0, lessonIndex) + 1).padStart(2, '0')}.py`
}
