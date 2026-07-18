/**
 * Bundled MicroPython library sources for the WEB sim (epic #267).
 * =============================================================================
 *
 * On the desktop, `window.api.instruments.librarySource()` reads the bundled
 * `micropython/instruments.py` (+ the `snakie.py` hardware umbrella) from disk in
 * the main process. The browser has no filesystem, so we inline the SAME sources
 * at build time via Vite `?raw`, then:
 *
 *  - auto-load them into the sim's in-memory VFS on connect (see the worker), so
 *    `from snakie import Servo` / `import instruments` — how the bundled demos and
 *    most projects start — work with no install step, and
 *  - answer `librarySource()` / `umbrellaSource()` (see {@link ./install-web-api}),
 *    so the "Install library" banner + its version check behave like the desktop
 *    instead of failing with "library source unavailable".
 *
 * These are the single source of truth for the two files; nothing here is
 * MicroPython-version-specific beyond what the desktop bundles.
 */
import instrumentsPy from '../../../../micropython/instruments.py?raw'
import snakiePy from '../../../../micropython/snakie.py?raw'

/** The `instruments` library (Servo/Buzzer/Led/… + the control loop). */
export const INSTRUMENTS_PY: string = instrumentsPy

/** The `snakie` hardware umbrella that re-exports the classes (shadow-proof imports). */
export const SNAKIE_PY: string = snakiePy

/**
 * Bundled module STUBS (`micropython/modules/*.py`) — the desktop packages this
 * folder as an app resource for the Modules panel's `bundled`-kind installs;
 * the web inlines the same files so hcsr04/mpu6050/neopixel_ws2812/rotary/
 * buzzer/teleop install on app.snakie.org too (#522). Keyed by file basename.
 */
const stubModules = import.meta.glob('../../../../micropython/modules/*.py', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

export const MODULE_STUBS: Record<string, string> = Object.fromEntries(
  Object.entries(stubModules).map(([path, contents]) => [path.split('/').pop() ?? path, contents])
)
