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
 * Opening a lesson seeds its starter `code` into a fresh editor buffer so the
 * learner can press Run right away. The lesson's own leading Markdown heading is
 * the title — we don't repeat it as a separate header.
 */
import { useEffect, useRef, useState } from 'react'
import { useTutorials } from '../store/tutorials'
import { useWorkspace } from '../store/workspace'
import { Markdown } from './Markdown'
import type { Course, CourseTrack } from '../lib/courses'
import './Tutorials.css'

const TRACK_LABEL: Record<CourseTrack, string> = {
  beginner: 'Start here',
  robotics: 'Robotics on the breadboard',
  urdf: 'Build a robot in 3-D'
}

export function TutorialPanel(): JSX.Element {
  const { courses, course, lessonIndex, openCourse, start, next, prev, goto, close } = useTutorials()
  const { openBuffer } = useWorkspace()
  const [tipOpen, setTipOpen] = useState(false)
  // Seed the editor once per (course, lesson) — not on every re-render.
  const seeded = useRef<string>('')

  const lesson = course && lessonIndex >= 0 ? course.lessons[lessonIndex] : null

  useEffect(() => {
    setTipOpen(false)
    if (!course || !lesson) return
    const key = `${course.id}#${lessonIndex}`
    if (seeded.current === key) return
    seeded.current = key
    if (lesson.code) {
      openBuffer(`${course.id}-${String(lessonIndex + 1).padStart(2, '0')}.py`, lesson.code)
    }
  }, [course, lesson, lessonIndex, openBuffer])

  // ── Gallery: pick a course ────────────────────────────────────────────────
  if (!course) {
    const tracks: CourseTrack[] = ['beginner', 'robotics', 'urdf']
    return (
      <div className="tp">
        <div className="tp__intro">
          <h1 className="tp__title">Learn Snakie</h1>
          <p className="tp__sub">Pick a project and follow along — each runs on the simulator, no hardware needed.</p>
        </div>
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
                      {c.emoji}
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
          <button className="tp__start" onClick={start}>
            Start →
          </button>
        </div>
      ) : (
        // ── Lesson (the Markdown's own heading is the title — no duplicate) ──
        <>
          <div className="tp__lesson">
            <Markdown source={lesson?.body ?? ''} className="tp__md" />
            {tipOpen && lesson?.tip && (
              <div className="tp__tip" role="note">
                <span className="tp__tip-bulb" aria-hidden>
                  💡
                </span>
                <Markdown source={lesson.tip} className="tp__tip-md" />
              </div>
            )}
          </div>

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
                💡
              </button>
            )}
            <button
              className="tp__nav tp__nav--next"
              onClick={lessonIndex >= lastLesson ? close : next}
            >
              {lessonIndex >= lastLesson ? 'Finish ✓' : 'Next ›'}
            </button>
          </footer>
        </>
      )}
    </div>
  )
}
