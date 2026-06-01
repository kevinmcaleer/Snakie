/**
 * Shared types for the local filesystem layer.
 *
 * Plain serializable shapes only (no Node fs.Stats instances) so they cross the
 * Electron IPC boundary cleanly and can be re-used by the preload typings and
 * the renderer.
 */

/** A single entry returned by `fs.readDir`. */
export interface FsEntry {
  /** Base name of the entry, e.g. `main.py`. */
  name: string
  /** Absolute path to the entry. */
  path: string
  /** True when the entry is a directory. */
  isDir: boolean
}

/** Result of `fs.stat`, mirroring the essentials of Node's `fs.Stats`. */
export interface FsStat {
  isDir: boolean
  /** File size in bytes. */
  size: number
  /** Modification time in milliseconds since epoch. */
  mtimeMs: number
}
