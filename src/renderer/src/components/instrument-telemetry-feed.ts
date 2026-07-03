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

import type {
  BindTelemetry,
  MeterTelemetry,
  PwmTelemetry,
  ScopeTelemetry,
  Telemetry
} from './instrument-telemetry'

/** How many recent scope samples to retain per channel for the live waveform. */
export const SCOPE_BUFFER = 256

/** The latest meter reading for a channel. */
export interface MeterReading {
  value: number
  unit: string
}

/** The latest live PWM reading for a channel (drives the scope's square wave). */
export interface PwmReading {
  freq: number
  duty: number
}

/**
 * The rolling telemetry store. `scope` maps a channel label → its recent sample
 * ring (oldest first); `meter` / `pwm` map a channel label → its latest reading.
 * All are plain objects so a snapshot is a cheap shallow copy for React state.
 */
export interface TelemetryFeed {
  scope: Record<string, number[]>
  meter: Record<string, MeterReading>
  pwm: Record<string, PwmReading>
  /** Objects the board is `watch`-ing: name → kind (`pwm`/`adc`/`i2c`/…). */
  binds: Record<string, string>
}

/** A fresh, empty feed. */
export function emptyFeed(): TelemetryFeed {
  return { scope: {}, meter: {}, pwm: {}, binds: {} }
}

/** Fold a parsed scope sample into the feed, returning a NEW feed. */
function foldScope(feed: TelemetryFeed, t: ScopeTelemetry): TelemetryFeed {
  const prev = feed.scope[t.ch] ?? []
  const next = prev.length >= SCOPE_BUFFER ? [...prev.slice(prev.length - SCOPE_BUFFER + 1), t.value] : [...prev, t.value]
  return { ...feed, scope: { ...feed.scope, [t.ch]: next } }
}

/** Fold a parsed meter reading into the feed, returning a NEW feed. */
function foldMeter(feed: TelemetryFeed, t: MeterTelemetry): TelemetryFeed {
  return { ...feed, meter: { ...feed.meter, [t.ch]: { value: t.value, unit: t.unit } } }
}

/** Fold a parsed live PWM reading into the feed, returning a NEW feed. */
function foldPwm(feed: TelemetryFeed, t: PwmTelemetry): TelemetryFeed {
  return { ...feed, pwm: { ...feed.pwm, [t.ch]: { freq: t.freq, duty: t.duty } } }
}

/** Fold an object-binding descriptor: set the name's kind, or drop it on `none`. */
function foldBind(feed: TelemetryFeed, t: BindTelemetry): TelemetryFeed {
  const binds = { ...feed.binds }
  if (t.objKind === 'none') delete binds[t.name]
  else binds[t.name] = t.objKind
  return { ...feed, binds }
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
  if (t.kind === 'pwm') return foldPwm(feed, t)
  if (t.kind === 'bind') return foldBind(feed, t)
  return feed // 'plot' etc. — not a scope/meter/pwm/bind sample
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

/** The latest live PWM reading (freq + duty) feeding `variable` (or undefined). */
export function pwmReadingFor(feed: TelemetryFeed, variable: string): PwmReading | undefined {
  const ch = matchChannel(variable, Object.keys(feed.pwm))
  return ch ? feed.pwm[ch] : undefined
}
