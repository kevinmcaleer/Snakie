import { useCallback, useEffect, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  clampSimHeapBytes,
  formatSimHeap,
  simHeapNeedsRestart,
  SIM_HEAP_MAX_BYTES,
  SIM_HEAP_MIN_BYTES,
  SIM_HEAP_PRESETS
} from '../../../shared/sim-memory'
import './SimMemoryDialog.css'

/**
 * SIMULATED DEVICE — MEMORY (issue #901).
 * =============================================================================
 *
 * The cog beside the port dropdown, shown only while the simulator is the
 * selected port. It sets the GC heap the virtual board boots with, which the
 * MicroPython WASM port really does accept (`loadMicroPython({ heapsize })` →
 * `mp_js_init(pystack, heapsize)`).
 *
 * The dialog spends as much space saying what the setting ISN'T as offering it,
 * on purpose. Two things would otherwise mislead someone who came here to
 * reproduce a board running out of RAM:
 *
 *  - the heap AUTO-GROWS, so this is a starting size and not a cap; and
 *  - `gc.mem_free()` reports the WASM headroom, not this number.
 *
 * Both are stated in the body rather than buried in a tooltip, because a memory
 * setting that quietly failed to bound memory would be worse than no setting.
 *
 * Applying costs a restart: the heap is fixed at `mp_js_init`, so it cannot
 * reach a live interpreter. When the simulator is running with a different heap
 * the primary button restarts it — and says that this clears the simulator's
 * files, because a restart re-spawns the worker and its RAM filesystem goes
 * with it (the same thing Stop does).
 */

interface SimMemoryDialogProps {
  /** Heap the setting currently holds (the next boot's). */
  value: number
  /** Heap the LIVE simulator started with; null when it isn't running. */
  booted: number | null
  /** Persist a new heap. */
  onSave: (bytes: number) => void
  /** Save AND restart the simulator so the new heap takes effect. */
  onSaveAndRestart: (bytes: number) => void
  onClose: () => void
}

export function SimMemoryDialog({
  value,
  booted,
  onSave,
  onSaveAndRestart,
  onClose
}: SimMemoryDialogProps): JSX.Element {
  const [draft, setDraft] = useState(value)
  // The custom field is kept as TEXT so a half-typed number ("", "1") doesn't
  // get clamped out from under the caret on every keystroke.
  const [customKb, setCustomKb] = useState(String(Math.round(value / 1024)))
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    setDraft(value)
    setCustomKb(String(Math.round(value / 1024)))
  }, [value])

  const pick = useCallback((bytes: number): void => {
    setDraft(bytes)
    setCustomKb(String(Math.round(bytes / 1024)))
  }, [])

  const onCustom = useCallback((text: string): void => {
    setCustomKb(text)
    const kb = Number(text)
    if (Number.isFinite(kb) && kb > 0) setDraft(clampSimHeapBytes(kb * 1024))
  }, [])

  // A restart is owed when the simulator is live on a different heap. When it
  // isn't running there is nothing to restart — saving is the whole action.
  const needsRestart = simHeapNeedsRestart(booted, draft)

  return (
    <div
      className="simmem-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="simmem"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="simmem-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <h2 className="simmem__title" id="simmem-title">
          Simulated device memory
        </h2>
        <p className="simmem__lede">
          How much heap the virtual board starts with. Useful for meeting a tight
          board&rsquo;s first <code>MemoryError</code> at your desk instead of on hardware.
        </p>

        <fieldset className="simmem__presets">
          <legend className="simmem__legend">Starting heap</legend>
          {SIM_HEAP_PRESETS.map((preset) => (
            <label
              key={preset.id}
              className={`simmem__preset${draft === preset.bytes ? ' simmem__preset--on' : ''}`}
            >
              <input
                type="radio"
                name="simmem-preset"
                value={preset.bytes}
                checked={draft === preset.bytes}
                onChange={() => pick(preset.bytes)}
              />
              <span className="simmem__preset-text">
                <span className="simmem__preset-label">{preset.label}</span>
                <span className="simmem__preset-hint">{preset.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="simmem__custom">
          <span className="simmem__custom-label">Or a custom size</span>
          <span className="simmem__custom-field">
            <input
              type="number"
              className="simmem__input"
              min={Math.round(SIM_HEAP_MIN_BYTES / 1024)}
              max={Math.round(SIM_HEAP_MAX_BYTES / 1024)}
              step={16}
              value={customKb}
              onChange={(e) => onCustom(e.target.value)}
            />
            <span className="simmem__unit">KB</span>
          </span>
        </label>

        {/* The honest part. Both of these would otherwise be discovered the hard
            way, by someone trusting the setting to bound the simulator's RAM. */}
        <div className="simmem__caveat">
          <p>
            <strong>This is a starting heap, not a limit.</strong> The MicroPython
            WebAssembly build grows its heap on demand: an allocation that
            doesn&rsquo;t fit raises <code>MemoryError</code>, and then the retry
            succeeds because the collector has just taken more room. So a small
            heap reproduces a tight board&rsquo;s <em>first</em> failure, but it
            won&rsquo;t starve a program that grows gradually.
          </p>
          <p>
            <code>gc.mem_free()</code> reports the WebAssembly heap&rsquo;s
            headroom &mdash; around 128&nbsp;MB &mdash; whatever you choose here.
            On the simulator it answers a different question than it does on a
            board.
          </p>
        </div>

        <p className="simmem__status" role="status">
          {booted === null
            ? 'The simulator isn’t running. It will start with this heap.'
            : needsRestart
              ? `The simulator is running with ${formatSimHeap(booted)}. Restarting it clears its files, exactly like Stop does.`
              : `The simulator is running with ${formatSimHeap(booted)}.`}
        </p>

        <div className="simmem__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          {needsRestart ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onSaveAndRestart(draft)}
            >
              Save and restart simulator
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => onSave(draft)}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
