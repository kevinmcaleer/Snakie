/**
 * Tutorials store (#479) — the Projects gallery + floating lesson dialog state.
 * =============================================================================
 *
 * Holds which course is open and which lesson you're on. `lessonIndex === -1` is
 * the course SPLASH (intro card); `0..n-1` are the lessons. Kept separate from
 * the editor: the {@link ../components/TutorialDialog} seeds the editor buffer
 * from the lesson's starter `code` when the lesson changes.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { loadCourses, type Course } from '../lib/courses'

interface TutorialsApi {
  courses: Course[]
  galleryOpen: boolean
  course: Course | null
  /** -1 = splash, 0..n-1 = a lesson. */
  lessonIndex: number
  openGallery: () => void
  closeGallery: () => void
  openCourse: (course: Course) => void
  start: () => void
  next: () => void
  prev: () => void
  goto: (i: number) => void
  close: () => void
}

const Ctx = createContext<TutorialsApi | null>(null)

export function TutorialsProvider({ children }: { children: ReactNode }): JSX.Element {
  const courses = useMemo(() => loadCourses(), [])
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [course, setCourse] = useState<Course | null>(null)
  const [lessonIndex, setLessonIndex] = useState(-1)

  const openGallery = useCallback(() => setGalleryOpen(true), [])
  const closeGallery = useCallback(() => setGalleryOpen(false), [])
  const openCourse = useCallback((c: Course) => {
    setCourse(c)
    setLessonIndex(-1) // splash first
    setGalleryOpen(false)
  }, [])
  const start = useCallback(() => setLessonIndex(0), [])
  const goto = useCallback(
    (i: number) => setLessonIndex((cur) => (course ? Math.max(-1, Math.min(course.lessons.length - 1, i)) : cur)),
    [course]
  )
  const next = useCallback(() => setLessonIndex((i) => (course ? Math.min(course.lessons.length - 1, i + 1) : i)), [course])
  const prev = useCallback(() => setLessonIndex((i) => Math.max(-1, i - 1)), [])
  const close = useCallback(() => {
    setCourse(null)
    setLessonIndex(-1)
  }, [])

  const api = useMemo<TutorialsApi>(
    () => ({ courses, galleryOpen, course, lessonIndex, openGallery, closeGallery, openCourse, start, next, prev, goto, close }),
    [courses, galleryOpen, course, lessonIndex, openGallery, closeGallery, openCourse, start, next, prev, goto, close]
  )
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useTutorials(): TutorialsApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTutorials must be used within a TutorialsProvider')
  return v
}
