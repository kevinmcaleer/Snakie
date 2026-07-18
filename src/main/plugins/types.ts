/**
 * Shared types for the Python plugin system (issue #61).
 *
 * These are plain, serializable shapes so they cross the Electron IPC boundary
 * cleanly and can be re-used by the preload typings and the renderer. They
 * mirror the JSON-RPC payloads exchanged with the Python host
 * (`python3 -m snakie.host`).
 */

/** Per-plugin discovery record returned by the host's `initialize`. */
export interface PluginInfo {
  /** Stable id (directory/module name, or entry-point name). */
  id: string
  /** Display name (defaults to the id). */
  name: string
  /** Absolute path to the plugin entry file (directory-discovered plugins). */
  path?: string
  /** How the plugin was found: a scanned directory or an entry point. */
  source: 'directory' | 'entry-point'
  /** False when the plugin failed to import (see `error`). */
  ok: boolean
  /** Import error message, when `ok` is false. */
  error?: string
}

/** A command a plugin registered, shown in the Plugins view. */
export interface CommandInfo {
  id: string
  title: string
  /** The id of the plugin that registered the command. */
  pluginId: string
}

/** The active editor file a command runs against. */
export interface PluginFileContext {
  path: string
  name: string
  source: string
  content: string
}

/** A text selection passed to a command (1-based). */
export interface PluginSelection {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text?: string
}

/** Context handed to a command on `runCommand`. */
export interface PluginContext {
  file: PluginFileContext
  selection?: PluginSelection
}

/** Show a message in the Plugins panel. */
export interface MessageAction {
  type: 'message'
  level: 'info' | 'warning' | 'error'
  text: string
}

/** Replace the active file's full contents. */
export interface EditAction {
  type: 'edit'
  content: string
}

/**
 * A quick-fix attached to a diagnostic, surfaced as an editor lightbulb action.
 * An absent range means "replace the diagnostic's own range" (fixes are always
 * ranged — there is no whole-file replacement form).
 */
export interface DiagnosticFix {
  title: string
  edit: {
    line?: number
    column?: number
    endLine?: number
    endColumn?: number
    newText: string
  }
}

/** A single diagnostic (problem marker / squiggle). Coordinates are 1-based. */
export interface Diagnostic {
  line: number
  column?: number
  endLine?: number
  endColumn?: number
  severity: string
  message: string
  source: string
  fixes?: DiagnosticFix[]
}

/** A single diagnostic action (problem marker) returned from a command. */
export interface DiagnosticAction {
  type: 'diagnostic'
  item: Diagnostic
}

/**
 * Show a message in the app's status bar. The latest status message(s) are
 * rendered in the status bar's left group; a higher `priority` wins when more
 * than one is present. When `href` is set the message is a clickable external
 * link (opened via {@link window.api.openExternal}).
 */
export interface StatusAction {
  type: 'status'
  text: string
  tooltip?: string
  href?: string
  priority?: number
}

/** Result of the `lint` RPC: all linters' diagnostics, concatenated. */
export interface LintResult {
  diagnostics: Diagnostic[]
}

/** Any action a command can return. */
export type PluginAction = MessageAction | EditAction | DiagnosticAction | StatusAction

/** Result of `runCommand`. */
export interface RunCommandResult {
  actions: PluginAction[]
}

/** Discovered plugins + their commands, returned by `list()`. */
export interface PluginListing {
  plugins: PluginInfo[]
  commands: CommandInfo[]
}

/**
 * Result of the `motion.read` RPC (#413): the pose library, sequences and servo
 * map parsed back out of a `.py`'s managed blocks. `ok:false` (a syntax error, a
 * non-literal managed value, or no Python) carries an `error` and means managed
 * rewrite should be suspended for the file. `pythonFound:false` distinguishes
 * "no interpreter" (round-trip skipped) from a genuine parse failure.
 */
export interface MotionReadResult {
  ok: boolean
  /** The schema version understood from the file's markers. */
  schema?: number
  /** pose name → { joint → value } (display units). */
  poses?: Record<string, Record<string, number>>
  /** sequence name → [poseName, durationMs, easing?] steps. */
  sequences?: Record<string, Array<[string, number] | [string, number, string]>>
  /** Servo bindings (pin/joint required; camelCase like `ServoJointBinding`). */
  servos?: Array<{
    pin: string
    joint: string
    jointMin?: number
    jointMax?: number
    servoMin?: number
    servoMax?: number
    invert?: boolean
  }>
  /** Non-fatal notes (dropped mis-shaped entries, a newer-schema block skipped). */
  warnings?: string[]
  /** Failure reason when `ok:false`. */
  error?: string
  /** False when no Python interpreter was available (round-trip skipped, not broken). */
  pythonFound?: boolean
}

/** Result of the lighter `motion.check` RPC — validity + schema, no data. */
export interface MotionCheckResult {
  ok: boolean
  schema?: number
  error?: string
  pythonFound?: boolean
}

/** Whether a Python interpreter + host were found. */
export interface PluginStatus {
  /** True when a Python interpreter was located and the host started. */
  pythonFound: boolean
  /** The interpreter command that was used, when found. */
  python?: string
  /** A human-readable reason when `pythonFound` is false (or the host died). */
  error?: string
}
