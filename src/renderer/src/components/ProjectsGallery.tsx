/**
 * PROJECTS gallery (#479) — a MakeCode-style grid of tutorial courses.
 * =============================================================================
 *
 * A full-window overlay of course tiles (emoji thumbnail + title + lesson count),
 * grouped by track. Picking one closes the gallery and starts its tutorial (the
 * floating {@link ./TutorialDialog}). Opened from the toolbar's **Learn** button.
 */
import { useTutorials } from '../store/tutorials'
import type { Course, CourseTrack } from '../lib/courses'
import './Tutorials.css'

const TRACK_LABEL: Record<CourseTrack, string> = {
  beginner: 'Start here',
  robotics: 'Robotics on the breadboard',
  urdf: 'Build a robot in 3-D'
}

export function ProjectsGallery(): JSX.Element | null {
  const { galleryOpen, closeGallery, openCourse, courses } = useTutorials()
  if (!galleryOpen) return null

  const tracks: CourseTrack[] = ['beginner', 'robotics', 'urdf']
  const byTrack = (t: CourseTrack): Course[] => courses.filter((c) => c.track === t)

  return (
    <div className="pg__overlay" role="dialog" aria-modal="true" aria-label="Tutorials">
      <div className="pg__panel">
        <header className="pg__head">
          <div>
            <h1 className="pg__title">Learn Snakie</h1>
            <p className="pg__sub">Pick a project and follow along — each one runs on the simulator, no hardware needed.</p>
          </div>
          <button className="pg__close" onClick={closeGallery} aria-label="Close tutorials" title="Close">
            ✕
          </button>
        </header>

        <div className="pg__scroll">
          {courses.length === 0 && <p className="pg__empty">No tutorials are bundled in this build yet.</p>}
          {tracks.map((t) => {
            const list = byTrack(t)
            if (!list.length) return null
            return (
              <section key={t} className="pg__section">
                <h2 className="pg__section-title">{TRACK_LABEL[t]}</h2>
                <div className="pg__grid">
                  {list.map((c) => (
                    <button
                      key={c.id}
                      className="pg__card"
                      style={{ '--accent': c.accent } as React.CSSProperties}
                      onClick={() => openCourse(c)}
                    >
                      <div className="pg__card-emoji" aria-hidden>
                        {c.emoji}
                      </div>
                      <div className="pg__card-body">
                        <div className="pg__card-title">{c.title}</div>
                        <div className="pg__card-desc">{c.description}</div>
                        <div className="pg__card-meta">{c.lessons.length} lessons</div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
