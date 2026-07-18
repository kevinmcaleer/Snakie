/**
 * ROBOT BUILD CHECKLIST (#436) — the Learn panel's "Build a robot" card.
 * =============================================================================
 *
 * Renders the eight-step robot build checklist above the course gallery. Live
 * steps auto-tick from project state (robot.yml + the linked URDF + the parts
 * library) and re-evaluate whenever those change (`robot.onChanged`,
 * `parts.onChanged`, open-editor edits). Observed steps ("write the app",
 * "run it on the simulator") latch ON when the evidence is seen and also offer
 * a manual checkbox; that record persists per-project in localStorage.
 *
 * All detection logic is pure and lives in {@link ./build-checklist} (unit
 * tested in `test/buildChecklist.test.ts`) — this component only wires it to
 * the live stores.
 */
import { useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { isVirtualPort } from '../../../shared/virtual-device'
import {
  checklistProgress,
  detectSteps,
  latchSticky,
  loadSticky,
  resolveChecklist,
  saveSticky,
  servoPartKeysOf,
  type BuildSnapshot,
  type BuildStepId,
  type StickyRecord
} from './build-checklist'
import type { RobotDefinition } from '../../../shared/robot'
import './BuildChecklist.css'

/** Collapse preference — global (not per-project), like the motion dock's. */
const COLLAPSED_KEY = 'snakie.buildChecklist.collapsed'

export function BuildChecklist(): JSX.Element {
  const { currentFolder, openFiles } = useWorkspace()
  const status = useDeviceStatus()

  // ── Live project state ────────────────────────────────────────────────────
  const [def, setDef] = useState<RobotDefinition | null>(null)
  const [robotNonce, setRobotNonce] = useState(0)
  // robot.yml edits arrive from any window (Board View, Robot View, poses).
  useEffect(() => window.api.robot.onChanged(() => setRobotNonce((n) => n + 1)), [])
  useEffect(() => {
    let live = true
    window.api.robot
      .load(currentFolder ?? undefined)
      .then((d) => {
        if (live) setDef(d)
      })
      .catch(() => {
        if (live) setDef(null)
      })
    return () => {
      live = false
    }
  }, [currentFolder, robotNonce])

  // Which library parts are servos (so a placed `sg90` counts as one).
  const [servoKeys, setServoKeys] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    let live = true
    const load = (): void => {
      window.api.parts
        .listLibraries()
        .then((libs) => {
          if (live) setServoKeys(servoPartKeysOf(libs))
        })
        .catch(() => undefined)
    }
    load()
    // `onChanged` is absent on some backends (web) — subscribe when available.
    const off = typeof window.api.parts.onChanged === 'function' ? window.api.parts.onChanged(load) : null
    return () => {
      live = false
      off?.()
    }
  }, [])

  // The linked URDF's text: an OPEN .urdf editor tab wins (live while the user
  // builds, unsaved edits included); otherwise read the project file from disk.
  const openUrdf = useMemo(() => {
    const f = openFiles.find((o) => /\.urdf$/i.test(o.name) || /\.urdf$/i.test(o.path))
    return f?.content ?? null
  }, [openFiles])
  const urdfRel = def?.robot?.urdf ?? null
  const [diskUrdf, setDiskUrdf] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!urdfRel || !currentFolder) {
      setDiskUrdf(null)
      return
    }
    const path = `${currentFolder.replace(/[/\\]$/, '')}/${urdfRel.replace(/^[/\\]/, '')}`
    window.api.fs
      .readFile(path)
      .then((text) => {
        if (live) setDiskUrdf(text)
      })
      .catch(() => {
        if (live) setDiskUrdf(null)
      })
    return () => {
      live = false
    }
  }, [urdfRel, currentFolder, robotNonce])

  // Open Python files (live content) for the "write your robot app" detector.
  const openPython = useMemo(
    () => openFiles.filter((f) => /\.py$/i.test(f.name)).map((f) => ({ name: f.name, content: f.content })),
    [openFiles]
  )

  // ── Detection + the per-project sticky record ─────────────────────────────
  const [sticky, setSticky] = useState<StickyRecord>(() => loadSticky(window.localStorage, null))
  useEffect(() => {
    setSticky(loadSticky(window.localStorage, currentFolder))
  }, [currentFolder])

  const detected = useMemo(() => {
    const snap: BuildSnapshot = {
      def,
      urdfText: openUrdf ?? diskUrdf,
      servoPartKeys: servoKeys,
      openPython,
      simulatorConnected: status.state === 'connected' && isVirtualPort(status.path)
    }
    return detectSteps(snap)
  }, [def, openUrdf, diskUrdf, servoKeys, openPython, status])

  // Latch observed achievements (open a matching .py, connect the simulator).
  useEffect(() => {
    setSticky((cur) => {
      const next = latchSticky(detected, cur)
      if (next !== cur) saveSticky(window.localStorage, currentFolder, next)
      return next
    })
  }, [detected, currentFolder])

  const toggleManual = (id: BuildStepId): void => {
    setSticky((cur) => {
      const next: StickyRecord = { ...cur, [id]: !cur[id] }
      saveSticky(window.localStorage, currentFolder, next)
      return next
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        /* preference only */
      }
      return !c
    })
  }

  const items = resolveChecklist(detected, sticky)
  const { done, total } = checklistProgress(items)
  const complete = done === total

  return (
    <section className="bcl" aria-label="Robot build checklist">
      <button
        className="bcl__head"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show the checklist' : 'Hide the checklist'}
      >
        <span className="bcl__head-emoji" aria-hidden>
          {complete ? '🏆' : '🤖'}
        </span>
        <span className="bcl__head-title">Robot build checklist</span>
        <span className={`bcl__count${complete ? ' bcl__count--done' : ''}`}>
          {done} / {total}
        </span>
        <span className="bcl__chev" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {!collapsed && (
        <ol className="bcl__list">
          {items.map(({ step, done: stepDone }, i) => (
            <li key={step.id} className={`bcl__row${stepDone ? ' bcl__row--done' : ''}`}>
              {step.mode === 'observed' ? (
                <input
                  type="checkbox"
                  className="bcl__check"
                  checked={stepDone}
                  onChange={() => toggleManual(step.id)}
                  aria-label={`Mark "${step.title}" done`}
                />
              ) : (
                <span className="bcl__tick" title="Ticks itself as you build" aria-hidden>
                  {stepDone ? '✓' : i + 1}
                </span>
              )}
              <span className="bcl__body">
                <span className="bcl__row-title">
                  {step.title}
                  <span className="bcl__where">{step.where}</span>
                </span>
                <span className="bcl__hint">{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {!collapsed && complete && (
        <p className="bcl__congrats">Robot complete — you built, posed and simulated it. Amazing work! 🎉</p>
      )}
    </section>
  )
}
