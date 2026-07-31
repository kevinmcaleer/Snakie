/**
 * TUTORIAL panel (#479) — the Learn view in the left sidebar.
 * =============================================================================
 *
 * The whole tutorial experience, docked in the activity-bar "Learn" view (no more
 * floating dialog / full-window overlay). Three states, driven by the tutorials
 * store:
 *   - no course chosen  → the course GALLERY (tiles grouped by track)
 *   - a course, splash  → the intro SPLASH card
 *   - a course, lesson  → the LESSON walkthrough (Markdown + prev/next/dots/tip)
 *
 * Opening a lesson seeds its starter `code` so the learner can press Run right
 * away — but never over work they have changed (see `seedAction`), and into the
 * SAME buffer each time rather than a fresh one per visit. A lesson may also
 * declare the `view` it is about, and opening it switches workspace, so a lesson
 * on wiring lands in Electronics instead of leaving the reader to find it.
 *
 * The lesson's own leading Markdown heading is the title — we don't repeat it as
 * a separate header.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTutorials } from '../store/tutorials'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { lessonFileName, seedAction } from '../lib/lesson-seed'
import { formatCourseLink, parseCourseLink, resolveLessonIndex } from '../lib/course-link'
import { Markdown } from './Markdown'
import { BuildChecklist } from './BuildChecklist'
import type { Course, CourseTrack } from '../lib/courses'
import { BulbIcon, CourseIcon } from './ui-icons'
import './Tutorials.css'

const TRACK_LABEL: Record<CourseTrack, string> = {
  beginner: 'Start here',
  robotics: 'Robotics on the breadboard',
  urdf: 'Build a robot in 3-D'
}

export function TutorialPanel(): JSX.Element {
  const { courses, course, lessonIndex, openCourse, start, next, prev, goto, close } = useTutorials()
  const { openBuffer, openFiles, setActive, updateContent } = useWorkspace()
  const { switchWorkspace } = useWorkspaceLayout()
  const [tipOpen, setTipOpen] = useState(false)
  // Seed the editor once per (course, lesson) — not on every re-render.
  const seeded = useRef<string>('')
  // Lessons whose overwrite prompt the user has already answered, so revisiting
  // one doesn't ask again. Per lesson: approving a reset on one must never
  // silently reset another.
  const asked = useRef<Set<string>>(new Set())

  const lesson = course && lessonIndex >= 0 ? course.lessons[lessonIndex] : null

  // Keep the URL in step with where the user is, so the address bar is always a
  // shareable entry point (#483). `replaceState` — a lesson step is not a
  // navigation, and filling the back button with them would trap the user.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return
    const hash = course ? formatCourseLink(course.id, lessonIndex >= 0 ? lessonIndex : null) : ''
    if (!hash && !window.location.hash.startsWith('#/learn/')) return
    if (window.location.hash === hash) return
    window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
  }, [course, lessonIndex])

  // Restore a course from the URL on load, and follow back/forward. Unknown ids
  // are IGNORED rather than surfaced as an error: a stale link should leave the
  // gallery usable, which is the issue's "failure paths leave the editor usable".
  useEffect(() => {
    const apply = (): void => {
      const link = parseCourseLink(window.location.hash)
      if (!link) return
      const found = courses.find((c) => c.id === link.courseId)
      if (!found) return
      openCourse(found)
      const idx = resolveLessonIndex(link, found.lessons.length)
      if (idx !== null) goto(idx)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
    // Courses are loaded once; re-running on every store identity change would
    // yank the user back to the URL's lesson after they clicked Next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses])

  /** Place a lesson's starter code without trampling the learner's own edits. */
  const seedLesson = useCallback((): void => {
    if (!course || !lesson?.code) return
    const name = lessonFileName(course.id, lessonIndex)
    const open = openFiles.find((f) => f.name === name)
    const key = `${course.id}#${lessonIndex}`
    const action = seedAction({
      starter: lesson.code,
      existing: open ? open.content : null,
      asked: asked.current.has(key)
    })
    if (action === 'keep') {
      if (open) setActive(open.id) // still bring their work to the front
      return
    }
    if (action === 'confirm') {
      asked.current.add(key)
      const ok = window.confirm(
        `"${name}" has changes you made.\n\nReplace it with this lesson's starter code?`
      )
      if (!ok) {
        if (open) setActive(open.id)
        return
      }
    }
    // Reuse the lesson's own buffer rather than opening another copy each visit.
    if (open) {
      updateContent(open.id, lesson.code)
      setActive(open.id)
    } else {
      openBuffer(name, lesson.code)
    }
  }, [course, lesson, lessonIndex, openFiles, openBuffer, setActive, updateContent])

  useEffect(() => {
    setTipOpen(false)
    if (!course || !lesson) return
    const key = `${course.id}#${lessonIndex}`
    if (seeded.current === key) return
    seeded.current = key
    seedLesson()
    // The workspace the lesson is ABOUT. Absent ⇒ stay put.
    if (lesson.view) switchWorkspace(lesson.view)
  }, [course, lesson, lessonIndex, seedLesson, switchWorkspace])

  // ── Gallery: pick a course ────────────────────────────────────────────────
  if (!course) {
    const tracks: CourseTrack[] = ['beginner', 'robotics', 'urdf']
    return (
      <div className="tp">
        <div className="tp__intro">
          <h1 className="tp__title">Learn Snakie</h1>
          <p className="tp__sub">Pick a project and follow along — each runs on the simulator, no hardware needed.</p>
        </div>
        <BuildChecklist />
        {courses.length === 0 && <p className="tp__empty">No tutorials are bundled in this build yet.</p>}
        {tracks.map((t) => {
          const list = courses.filter((c) => c.track === t)
          if (!list.length) return null
          return (
            <section key={t} className="tp__section">
              <h2 className="tp__section-title">{TRACK_LABEL[t]}</h2>
              <div className="tp__grid">
                {list.map((c) => (
                  <button
                    key={c.id}
                    className="tp__card"
                    style={{ '--accent': c.accent } as React.CSSProperties}
                    onClick={() => openCourse(c)}
                  >
                    <span className="tp__card-emoji" aria-hidden>
                      <CourseIcon emoji={c.emoji} size={30} />
                    </span>
                    <span className="tp__card-body">
                      <span className="tp__card-title">{c.title}</span>
                      <span className="tp__card-desc">{c.description}</span>
                      <span className="tp__card-meta">{c.lessons.length} lessons</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  // ── A course is open: splash or a lesson ──────────────────────────────────
  const accent = { '--accent': course.accent } as React.CSSProperties
  const lastLesson = (course as Course).lessons.length - 1

  return (
    <div className="tp" style={accent}>
      <header className="tp__bar">
        <span className="tp__bar-emoji" aria-hidden>
          {course.emoji}
        </span>
        <span className="tp__bar-title">{course.title}</span>
        <button className="tp__all" onClick={close} title="All tutorials" aria-label="Back to all tutorials">
          ☰ All
        </button>
      </header>

      {lessonIndex === -1 ? (
        // ── Splash ──────────────────────────────────────────────────────────
        <div className="tp__splash">
          <div className="tp__splash-emoji" aria-hidden>
            {course.emoji}
          </div>
          <h2 className="tp__splash-title">{course.title}</h2>
          <p className="tp__splash-desc">{course.description}</p>
          <p className="tp__splash-meta">{course.lessons.length} lessons</p>
          <ol className="tp__toc" aria-label="Lessons in this course">
            {course.lessons.map((l, i) => (
              <li key={i}>
                <button className="tp__toc-item" onClick={() => goto(i)}>
                  <span className="tp__toc-num">{i + 1}</span>
                  <span className="tp__toc-name">{l.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <button className="tp__start" onClick={start}>
            Start →
          </button>
        </div>
      ) : (
        // ── Lesson (the Markdown's own heading is the title — no duplicate) ──
        <>
          <div className="tp__lesson">
            <Markdown source={lesson?.body ?? ''} className="tp__md" />
          </div>

          {/* Tip + nav are pinned to the bottom of the panel so the 💡 tip is
              always visible when toggled (not stranded below the scroll fold). */}
          <div className="tp__bottom">
            {tipOpen && lesson?.tip && (
              <div className="tp__tip" role="note">
                <span className="tp__tip-bulb" aria-hidden>
                  <BulbIcon size={14} />
                </span>
                <Markdown source={lesson.tip} className="tp__tip-md" />
              </div>
            )}
            <footer className="tp__foot">
              <button className="tp__nav" onClick={prev} title="Previous" disabled={lessonIndex <= -1}>
                ‹ Back
              </button>
              <div className="tp__dots" role="tablist" aria-label="Lesson">
                {course.lessons.map((_, i) => (
                  <button
                    key={i}
                    className={`tp__dot${i === lessonIndex ? ' tp__dot--on' : ''}`}
                    onClick={() => goto(i)}
                    aria-label={`Lesson ${i + 1}`}
                    aria-selected={i === lessonIndex}
                  />
                ))}
              </div>
              {lesson?.tip && (
                <button
                  className={`tp__tipbtn${tipOpen ? ' tp__tipbtn--on' : ''}`}
                  onClick={() => setTipOpen((v) => !v)}
                  title="Tip"
                  aria-label="Show a tip"
                  aria-pressed={tipOpen}
                >
                  <BulbIcon size={14} />
                </button>
              )}
              <button
                className="tp__nav tp__nav--next"
                onClick={lessonIndex >= lastLesson ? close : next}
              >
                {lessonIndex >= lastLesson ? 'Finish ✓' : 'Next ›'}
              </button>
            </footer>
          </div>
        </>
      )}
    </div>
  )
}
