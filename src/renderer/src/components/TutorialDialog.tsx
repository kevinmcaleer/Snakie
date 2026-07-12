/**
 * TUTORIAL dialog (#479) — the floating lesson panel over the app.
 * =============================================================================
 *
 * Shows the current lesson's Markdown with **prev / next**, position **dots**, and
 * a **tip** lightbulb (a popup with a hint or snippet). Opening a course shows a
 * SPLASH card first (`lessonIndex === -1`). When a lesson opens, its starter
 * `code` is seeded into a fresh editor buffer so the learner can Run it right away.
 */
import { useEffect, useRef, useState } from 'react'
import { useTutorials } from '../store/tutorials'
import { useWorkspace } from '../store/workspace'
import { Markdown } from './Markdown'
import './Tutorials.css'

export function TutorialDialog(): JSX.Element | null {
  const { course, lessonIndex, next, prev, goto, start, close, openGallery } = useTutorials()
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

  if (!course) return null
  const accent = { '--accent': course.accent } as React.CSSProperties

  return (
    <aside className="td" style={accent} role="dialog" aria-label={`${course.title} tutorial`}>
      <header className="td__head">
        <span className="td__emoji" aria-hidden>
          {course.emoji}
        </span>
        <span className="td__course">{course.title}</span>
        <button className="td__icon" onClick={openGallery} title="All tutorials" aria-label="All tutorials">
          ☰
        </button>
        <button className="td__icon" onClick={close} title="Close tutorial" aria-label="Close tutorial">
          ✕
        </button>
      </header>

      {lessonIndex === -1 ? (
        // ── Splash ──────────────────────────────────────────────────────────
        <div className="td__splash">
          <div className="td__splash-emoji" aria-hidden>
            {course.emoji}
          </div>
          <h2 className="td__splash-title">{course.title}</h2>
          <p className="td__splash-desc">{course.description}</p>
          <p className="td__splash-meta">{course.lessons.length} lessons</p>
          <button className="td__start" onClick={start}>
            Start →
          </button>
        </div>
      ) : (
        // ── Lesson ──────────────────────────────────────────────────────────
        <>
          <div className="td__body">
            <h3 className="td__lesson-title">{lesson?.title}</h3>
            <Markdown source={lesson?.body ?? ''} className="td__md" />
          </div>

          {tipOpen && lesson?.tip && (
            <div className="td__tip" role="note">
              <span className="td__tip-bulb" aria-hidden>
                💡
              </span>
              <Markdown source={lesson.tip} className="td__tip-md" />
            </div>
          )}

          <footer className="td__foot">
            <button className="td__nav" onClick={prev} title="Previous">
              ‹ Back
            </button>
            <div className="td__dots" role="tablist" aria-label="Lesson">
              {course.lessons.map((_, i) => (
                <button
                  key={i}
                  className={`td__dot${i === lessonIndex ? ' td__dot--on' : ''}`}
                  onClick={() => goto(i)}
                  aria-label={`Lesson ${i + 1}`}
                  aria-selected={i === lessonIndex}
                />
              ))}
            </div>
            {lesson?.tip && (
              <button
                className={`td__tipbtn${tipOpen ? ' td__tipbtn--on' : ''}`}
                onClick={() => setTipOpen((v) => !v)}
                title="Tip"
                aria-label="Show a tip"
                aria-pressed={tipOpen}
              >
                💡
              </button>
            )}
            <button
              className="td__nav td__nav--next"
              onClick={lessonIndex >= course.lessons.length - 1 ? close : next}
            >
              {lessonIndex >= course.lessons.length - 1 ? 'Finish ✓' : 'Next ›'}
            </button>
          </footer>
        </>
      )}
    </aside>
  )
}
