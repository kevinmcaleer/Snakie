/**
 * Pure readout helpers for the Serial Plotter strip-chart (issue #103),
 * extracted from `Plotter.tsx` so the sample-rate maths + the on-screen
 * `<N> samples · <rate> Hz` label can be unit-tested without React/canvas.
 *
 * The plotter reads `print()` output line-by-line; each parsed line advances the
 * X (sample) axis by one. The handoff shows a `120 samples · 10 Hz` readout in
 * the bottom-right of the blue-phosphor screen — these helpers derive both
 * halves of that string from the live buffer.
 */

/**
 * Estimate the sample rate (Hz) from a list of recent sample timestamps (ms,
 * oldest → newest). Returns 0 when there isn't enough history (< 2 samples) or
 * the timestamps don't span any time. The rate is the number of *intervals*
 * divided by the total elapsed seconds, so N timestamps over T seconds yields
 * `(N - 1) / T` — a stable estimate of the streaming cadence.
 */
export function estimateHz(timestamps: number[]): number {
  if (timestamps.length < 2) return 0
  const first = timestamps[0]
  const last = timestamps[timestamps.length - 1]
  const elapsedMs = last - first
  if (elapsedMs <= 0) return 0
  return ((timestamps.length - 1) / elapsedMs) * 1000
}

/** Round a Hz estimate to a tidy display value (1 decimal under 10 Hz). */
export function formatHz(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '—'
  if (hz >= 10) return `${Math.round(hz)} Hz`
  return `${hz.toFixed(1)} Hz`
}

/**
 * Build the bottom-right readout string, e.g. `120 samples · 10 Hz`. When the
 * rate can't be derived yet (too few samples) the Hz half is omitted so the
 * label reads simply `0 samples` / `5 samples`.
 */
export function sampleReadout(sampleCount: number, hz: number): string {
  const samples = `${sampleCount} sample${sampleCount === 1 ? '' : 's'}`
  if (!Number.isFinite(hz) || hz <= 0) return samples
  return `${samples} · ${formatHz(hz)}`
}
