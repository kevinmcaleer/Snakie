/**
 * RANGE INSTRUMENT DEF (self-contained descriptor) — issue #112.
 * =============================================================================
 *
 * The distance-sensor RADAR (#112) is a SELF-CONTAINED dock panel whose contract
 * is `RangeInstrument({ def, onClose, docked })`, where `def` is an
 * {@link InstrumentDef} descriptor (id / name / accent / border).
 *
 * On the dock-framework branches an `InstrumentDef` comes from a central
 * `instruments-registry` module; that registry is NOT present on this branch (this
 * worktree carries the legacy scope/meter/plotter generation) and this panel may
 * not edit shared host files to register itself. So this module provides the SAME
 * `InstrumentDef` SHAPE plus the single `range` descriptor — kept panel-local
 * (own filename, no collision with the future shared registry) so the radar
 * compiles + renders identically whether hosted by the eventual registry or stood
 * up on its own. The host's richer `InstrumentDef` is a structural superset of
 * this one, so the panel drops in unchanged once the framework lands.
 */

/** A per-instrument descriptor (id / display name / accent colours). */
export interface InstrumentDef {
  /** Stable id (the radar is `'range'`). */
  id: string
  /** Display name (rendered, upper-cased, in the window title bar). */
  name: string
  /** Accent colour for the panel theme (`--accent`). */
  accent: string
  /** Accent border colour for the panel theme (`--accent-border`). */
  border: string
}

/** The distance-sensor radar descriptor (#112): id `range`, amber accent. */
export const RANGE_DEF: InstrumentDef = {
  id: 'range',
  name: 'Range',
  accent: '#f0b94a',
  border: 'rgba(240,185,74,.5)'
}
