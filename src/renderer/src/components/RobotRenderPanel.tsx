import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  estimateBytes,
  etaSeconds,
  FORMAT_INFO,
  formatBytes,
  formatSupported,
  loadRender,
  planRender,
  QUICK_DRAFT,
  saveRender,
  SIZE_LABEL,
  type RenderFormat,
  type RenderJob,
  type RenderResult,
  type RenderSettings
} from './robot-render'
import './RobotRenderPanel.css'

/**
 * RENDER MOVIE (Animate) — turn the timeline into a movie file, on this
 * computer. Pick a size and a look, press Render, watch the frames arrive, then
 * save or share the result. Nothing is uploaded and nothing is metered.
 *
 * The panel owns the settings, the progress and the finished file; the frames
 * themselves are drawn by the 3-D view through `onRender`.
 */
export interface RobotRenderPanelProps {
  /** What is being rendered: its name, one play-through's length, and whether it loops. */
  clip: { label: string; seconds: number; loop: boolean }
  /** Used to name the saved file. */
  fileBase: string
  /** Run a render (or, with `still`, draw one preview frame). */
  onRender: (job: Omit<RenderJob, 'poseAt'>) => Promise<RenderResult>
  onClose: () => void
}

type Phase =
  | { kind: 'setup' }
  | { kind: 'rendering'; done: number; startedAt: number }
  | { kind: 'done'; blob: Blob; url: string; format: RenderFormat; tookMs: number }
  | { kind: 'failed'; message: string }

interface Choice<T> {
  value: T
  label: string
  hint: string
}

function Choices<T extends string | number>({
  label,
  value,
  options,
  onPick,
  disabled
}: {
  label: string
  value: T
  options: Choice<T>[]
  onPick: (v: T) => void
  disabled: boolean
}): JSX.Element {
  return (
    <div className="rrender__field" role="group" aria-label={label}>
      <span className="rrender__label">{label}</span>
      <div className="rrender__chips">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className={`rrender__chip${o.value === value ? ' is-on' : ''}`}
            aria-pressed={o.value === value}
            title={o.hint}
            onClick={() => !disabled && onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'robot'

export function RobotRenderPanel({ clip, fileBase, onRender, onClose }: RobotRenderPanelProps): JSX.Element {
  const [settings, setSettings] = useState<RenderSettings>(() => loadRender(window.localStorage))
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  // Which movie formats this computer can encode (null = still checking).
  const [canMake, setCanMake] = useState<Partial<Record<RenderFormat, boolean>>>({ gif: true, png: true })
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)

  const plan = useMemo(() => planRender(settings, clip.seconds), [settings, clip.seconds])
  const busy = phase.kind === 'rendering'

  const change = (patch: Partial<RenderSettings>): void => {
    if (busy) return
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveRender(window.localStorage, next)
      return next
    })
    setPhase((p) => (p.kind === 'rendering' ? p : { kind: 'setup' }))
  }

  // Check MP4 / WebM for the chosen size and frame rate.
  useEffect(() => {
    let live = true
    void Promise.all([formatSupported('mp4', plan), formatSupported('webm', plan)]).then(([mp4, webm]) => {
      if (live) setCanMake({ gif: true, png: true, mp4, webm })
    })
    return () => {
      live = false
    }
  }, [plan.width, plan.height, plan.fps, plan.bitrate]) // eslint-disable-line react-hooks/exhaustive-deps

  // A still of the first frame whenever the picture would change.
  useEffect(() => {
    if (phase.kind !== 'setup') return
    const id = window.setTimeout(() => {
      void onRender({ settings, plan, preview: previewRef.current, still: true })
    }, 120)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, settings.size, settings.look, settings.camera, settings.watermark, settings.format, settings.quality])

  // Free the finished file's URL when it is replaced or the panel closes.
  const releaseUrl = (): void => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }
  useEffect(
    () => () => {
      abortRef.current?.abort()
      releaseUrl()
    },
    []
  )

  const start = async (override?: Partial<RenderSettings>): Promise<void> => {
    if (busy) return
    const use = { ...settings, ...override }
    // A quick draft shows its settings, but does not replace your saved ones.
    if (override) setSettings(use)
    const usePlan = planRender(use, clip.seconds)
    releaseUrl()
    const ac = new AbortController()
    abortRef.current = ac
    const startedAt = performance.now()
    setPhase({ kind: 'rendering', done: 0, startedAt })
    let last = 0
    const res = await onRender({
      settings: use,
      plan: usePlan,
      preview: previewRef.current,
      signal: ac.signal,
      onProgress: (done) => {
        // The bar moves ~10 times a second, not once per frame.
        const now = performance.now()
        if (now - last < 100 && done < usePlan.frames) return
        last = now
        setPhase({ kind: 'rendering', done, startedAt })
      }
    })
    abortRef.current = null
    if (res.blob) {
      const url = URL.createObjectURL(res.blob)
      urlRef.current = url
      setPhase({ kind: 'done', blob: res.blob, url, format: use.format, tookMs: performance.now() - startedAt })
    } else if (res.error === 'cancelled') {
      setPhase({ kind: 'setup' })
    } else if (res.error === 'unsupported') {
      setPhase({
        kind: 'failed',
        message: `This computer can't make ${FORMAT_INFO[use.format].label} at this size. Try a smaller size, or pick another format below.`
      })
    } else {
      setPhase({
        kind: 'failed',
        message: 'The render stopped before it finished. A smaller size or Draft quality needs less memory, so try that.'
      })
    }
  }

  const fileName = `${slug(fileBase)}-${slug(clip.label)}.${FORMAT_INFO[phase.kind === 'done' ? phase.format : settings.format].ext}`
  const save = (): void => {
    if (phase.kind !== 'done') return
    const a = document.createElement('a')
    a.href = phase.url
    a.download = fileName
    a.click()
  }
  const shareFile =
    phase.kind === 'done' ? new File([phase.blob], fileName, { type: FORMAT_INFO[phase.format].mime }) : null
  const canShare =
    !!shareFile && typeof navigator.canShare === 'function' && navigator.canShare({ files: [shareFile] })
  const share = (): void => {
    if (shareFile) void navigator.share({ files: [shareFile], title: clip.label }).catch(() => undefined)
  }

  const unsupported = canMake[settings.format] === false
  const fallback: RenderFormat = canMake.mp4 ? 'mp4' : canMake.webm ? 'webm' : 'gif'
  const eta = phase.kind === 'rendering' ? etaSeconds(phase.done, plan.frames, performance.now() - phase.startedAt) : null
  const loopsNote =
    plan.loops < settings.loops ? ` (shortened to ${plan.loops} so the movie stays under two minutes)` : ''

  return (
    <div className="rrender__scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="rrender" role="dialog" aria-modal="true" aria-label="Render movie">
        <header className="rrender__head">
          <h2 className="rrender__title">Render movie</h2>
          <span className="rrender__sub">
            {clip.label} · {Number(clip.seconds.toFixed(2))} s × {plan.loops} = {Number(plan.seconds.toFixed(1))} s ·{' '}
            {plan.frames} frames
          </span>
          <span className="rrender__spacer" />
          <span className="rrender__pill">Renders on this computer. No credits.</span>
          <button
            type="button"
            className="rrender__close"
            onClick={() => {
              abortRef.current?.abort()
              onClose()
            }}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="rrender__body">
          <section className="rrender__stage">
            <div className="rrender__screen">
              {phase.kind === 'done' && (phase.format === 'mp4' || phase.format === 'webm') ? (
                <video className="rrender__media" src={phase.url} controls loop autoPlay muted playsInline />
              ) : phase.kind === 'done' && phase.format === 'gif' ? (
                <img className="rrender__media" src={phase.url} alt="The rendered movie" />
              ) : null}
              {/* Kept mounted (hidden under a finished movie) so a re-render reuses it. */}
              <canvas
                ref={previewRef}
                className="rrender__media"
                style={phase.kind === 'done' && phase.format !== 'png' ? { display: 'none' } : undefined}
                aria-label="Preview of the movie"
              />
              <span className="rrender__badge">
                {plan.width} × {plan.height}
                {phase.kind === 'rendering' ? ` · frame ${phase.done}` : ''}
              </span>
            </div>

            <div className="rrender__status" aria-live="polite">
              {phase.kind === 'rendering' ? (
                <>
                  <div className="rrender__statusrow">
                    <strong>
                      Rendering frame {phase.done} of {plan.frames}
                    </strong>
                    <span className="rrender__mono">{eta == null ? 'working out the time…' : `about ${eta} s left`}</span>
                  </div>
                  <div
                    className="rrender__bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={plan.frames}
                    aria-valuenow={phase.done}
                  >
                    <div className="rrender__barfill" style={{ width: `${(phase.done / plan.frames) * 100}%` }} />
                  </div>
                </>
              ) : phase.kind === 'done' ? (
                <div className="rrender__statusrow">
                  <strong>
                    Your movie is ready · {formatBytes(phase.blob.size)}
                    {phase.format === 'png' ? ` · ${plan.frames} pictures in a zip` : ''}
                  </strong>
                  <span className="rrender__mono">took {Math.max(1, Math.round(phase.tookMs / 1000))} s</span>
                </div>
              ) : phase.kind === 'failed' ? (
                <p className="rrender__note rrender__note--warn">{phase.message}</p>
              ) : (
                <div className="rrender__statusrow">
                  <span>
                    This is the first frame. The movie will be about{' '}
                    <strong>{formatBytes(estimateBytes(settings.format, plan))}</strong>
                    {loopsNote}.
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="rrender__settings" aria-label="Movie settings">
            <Choices
              label="Size"
              value={settings.size}
              disabled={busy}
              onPick={(size) => change({ size })}
              options={[
                { value: '720p', label: SIZE_LABEL['720p'], hint: '1280 × 720 — quick, small file' },
                { value: '1080p', label: SIZE_LABEL['1080p'], hint: '1920 × 1080 — full HD, right for YouTube' },
                { value: '4k', label: SIZE_LABEL['4k'], hint: '3840 × 2160 — very sharp, slow to render' },
                { value: 'square', label: SIZE_LABEL.square, hint: '1080 × 1080 — for feeds' },
                { value: 'vertical', label: SIZE_LABEL.vertical, hint: '1080 × 1920 — for phones, Shorts and Reels' }
              ]}
            />
            <div className="rrender__pair">
              <Choices
                label="Frame rate"
                value={settings.fps}
                disabled={busy}
                onPick={(fps) => change({ fps })}
                options={[
                  { value: 24, label: '24', hint: '24 frames a second — like film' },
                  { value: 30, label: '30', hint: '30 frames a second — the usual choice' },
                  { value: 60, label: '60', hint: '60 frames a second — extra smooth, twice the work' }
                ]}
              />
              <label className="rrender__field">
                <span className="rrender__label">Loops</span>
                <input
                  className="rrender__number"
                  type="number"
                  min={1}
                  max={20}
                  value={settings.loops}
                  readOnly={busy}
                  title="How many times the motion plays through"
                  onChange={(e) => change({ loops: Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))) })}
                />
              </label>
            </div>
            <Choices
              label="Camera"
              value={settings.camera}
              disabled={busy}
              onPick={(camera) => change({ camera })}
              options={[
                { value: 'current', label: 'Current view', hint: 'The angle you are looking from now, framed to fit the robot' },
                { value: 'turntable', label: 'Turntable', hint: 'The camera circles the robot once while it moves' }
              ]}
            />
            <Choices
              label="Look"
              value={settings.look}
              disabled={busy}
              onPick={(look) => change({ look })}
              options={[
                { value: 'studio-light', label: 'Studio light', hint: 'The robot on a plain light floor with a soft shadow' },
                { value: 'studio-dark', label: 'Studio dark', hint: 'The robot on a plain dark floor with a soft shadow' },
                { value: 'editor', label: 'Grid', hint: 'As it looks in the editor, grid and all' }
              ]}
            />
            <Choices
              label="Quality"
              value={settings.quality}
              disabled={busy}
              onPick={(quality) => change({ quality })}
              options={[
                { value: 'draft', label: 'Draft', hint: 'Fastest, to check the motion' },
                { value: 'good', label: 'Good', hint: 'Smooth edges, sensible file size' },
                { value: 'best', label: 'Best', hint: 'Drawn at twice the size and scaled down — smoothest edges, slowest' }
              ]}
            />
            <Choices
              label="Format"
              value={settings.format}
              disabled={busy}
              onPick={(format) => change({ format })}
              options={(['mp4', 'webm', 'gif', 'png'] as const).map((f) => ({
                value: f,
                label: FORMAT_INFO[f].label,
                hint: FORMAT_INFO[f].blurb
              }))}
            />
            {unsupported ? (
              <p className="rrender__note rrender__note--warn">
                This computer can&apos;t make {FORMAT_INFO[settings.format].label} at this size.{' '}
                <button type="button" className="rrender__link" onClick={() => change({ format: fallback })}>
                  Use {FORMAT_INFO[fallback].label} instead
                </button>
              </p>
            ) : (
              <p className="rrender__note">
                {FORMAT_INFO[settings.format].blurb}
                {settings.format === 'gif' ? ` Rendered at ${plan.width} × ${plan.height}, ${plan.fps} frames a second.` : ''}
              </p>
            )}
            <label className="rrender__switchrow">
              <span>Show &quot;Made with snakie.org&quot;</span>
              <input
                type="checkbox"
                className="rrender__switch"
                role="switch"
                checked={settings.watermark}
                onChange={(e) => change({ watermark: e.target.checked })}
              />
            </label>

            <span className="rrender__grow" />

            <div className="rrender__actions">
              {phase.kind === 'rendering' ? (
                <>
                  <span className="rrender__grow" />
                  <button type="button" className="rrender__btn" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </button>
                </>
              ) : phase.kind === 'done' ? (
                <>
                  <button type="button" className="rrender__btn" onClick={() => setPhase({ kind: 'setup' })}>
                    Render again
                  </button>
                  <span className="rrender__grow" />
                  {canShare && (
                    <button type="button" className="rrender__btn" onClick={share}>
                      Share
                    </button>
                  )}
                  <button type="button" className="rrender__btn rrender__btn--primary" onClick={save}>
                    Save movie
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="rrender__btn"
                    onClick={() => void start(QUICK_DRAFT)}
                    title="A small, fast render to check the motion (720p, 24 frames a second, Draft)"
                  >
                    Quick draft
                  </button>
                  <span className="rrender__grow" />
                  <button type="button" className="rrender__btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rrender__btn rrender__btn--primary"
                    onClick={() => void start(unsupported ? { format: fallback } : undefined)}
                  >
                    {unsupported ? `Render as ${FORMAT_INFO[fallback].label}` : 'Render'}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default RobotRenderPanel
