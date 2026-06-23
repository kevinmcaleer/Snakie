/**
 * INSTRUMENT TELEMETRY FEED — pure, DOM-free state for the passive, always-on
 * telemetry source that drives the scope/meter from printed `SNK …` lines
 * (issue #107).
 * =============================================================================
 *
 * The on-device instruments library prints telemetry the IDE consumes by
 * parsing the broadcast serial stream — NON-INVASIVELY, so it works inside a
 * running `while True:` loop (unlike the raw-REPL LIVE poll, which interrupts
 * the program). This module is the framework-free heart of that source:
 *
 *   - {@link emptyFeed} / {@link foldTelemetry} — a rolling per-channel store of
 *     the latest scope samples (a small ring for the live waveform) and the
 *     latest meter reading. Pure reducers, so a React hook can keep one in a ref
 *     and re-render from snapshots.
 *   - {@link matchChannel} — resolve which channel's data feeds a given open
 *     instrument: an exact channel-label match wins, else (when exactly one
 *     channel has reported) we fall back to that sole channel so a single open
 *     scope/meter "just works" without the label lining up.
 *
 * Nothing here throws; mirrors {@link ./instrument-data} / {@link ./board-values}.
 */

import type { MeterTelemetry, ScopeTelemetry, Telemetry } from './instrument-telemetry'

/** How many recent scope samples to retain per channel for the live waveform. */
export const SCOPE_BUFFER = 256

/** The latest meter reading for a channel. */
export interface MeterReading {
  value: number
  unit: string
}

/**
 * The rolling telemetry store. `scope` maps a channel label → its recent sample
 * ring (oldest first); `meter` maps a channel label → its latest reading. Both
 * are plain objects so a snapshot is a cheap shallow copy for React state.
 */
export interface TelemetryFeed {
  scope: Record<string, number[]>
  meter: Record<string, MeterReading>
}

/** A fresh, empty feed. */
export function emptyFeed(): TelemetryFeed {
  return { scope: {}, meter: {} }
}

/** Fold a parsed scope sample into the feed, returning a NEW feed. */
function foldScope(feed: TelemetryFeed, t: ScopeTelemetry): TelemetryFeed {
  const prev = feed.scope[t.ch] ?? []
  const next = prev.length >= SCOPE_BUFFER ? [...prev.slice(prev.length - SCOPE_BUFFER + 1), t.value] : [...prev, t.value]
  return { scope: { ...feed.scope, [t.ch]: next }, meter: feed.meter }
}

/** Fold a parsed meter reading into the feed, returning a NEW feed. */
function foldMeter(feed: TelemetryFeed, t: MeterTelemetry): TelemetryFeed {
  return {
    scope: feed.scope,
    meter: { ...feed.meter, [t.ch]: { value: t.value, unit: t.unit } }
  }
}

/**
 * Fold one parsed {@link Telemetry} into the feed. PLOT telemetry is ignored
 * here (the Plotter consumes it directly); SCOPE/METER update their channel.
 * Returns the SAME feed reference for ignored input so callers can skip a
 * re-render. Never throws.
 */
export function foldTelemetry(feed: TelemetryFeed, t: Telemetry | null): TelemetryFeed {
  if (!t) return feed
  if (t.kind === 'scope') return foldScope(feed, t)
  if (t.kind === 'meter') return foldMeter(feed, t)
  return feed // 'plot' — not a scope/meter sample
}

/**
 * Resolve the channel key whose data should feed an instrument bound to
 * `variable`, given the channels that have actually reported (`channels`).
 *
 *   1. An exact match (`variable === channel`) always wins.
 *   2. Otherwise, if EXACTLY ONE channel has reported, use it — so a single open
 *      scope/meter picks up telemetry even when the channel label doesn't match
 *      the parsed variable name (the common "just print and watch" case).
 *   3. Otherwise (ambiguous: 0 or ≥2 channels, none matching) → `undefined`,
 *      and the instrument falls back to its REPL-poll / static reading.
 */
export function matchChannel(variable: string, channels: string[]): string | undefined {
  if (channels.includes(variable)) return variable
  if (channels.length === 1) return channels[0]
  return undefined
}

/** The recent scope samples feeding `variable` (empty when no match). */
export function scopeSamplesFor(feed: TelemetryFeed, variable: string): number[] {
  const ch = matchChannel(variable, Object.keys(feed.scope))
  return ch ? feed.scope[ch] ?? [] : []
}

/** The latest meter reading feeding `variable` (undefined when no match). */
export function meterReadingFor(feed: TelemetryFeed, variable: string): MeterReading | undefined {
  const ch = matchChannel(variable, Object.keys(feed.meter))
  return ch ? feed.meter[ch] : undefined
}
