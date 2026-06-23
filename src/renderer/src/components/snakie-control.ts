/**
 * SNAKIE CONTROL (renderer view) — re-exports the shared IDE→board control
 * protocol (issue #115) so the Terminal filter + UI import it from a single
 * components-local module, mirroring how {@link ./instrument-telemetry} sits
 * next to the other instrument helpers.
 *
 * The wire-format core lives in `src/shared/control.ts` (dependency-free) so the
 * MAIN process (`MicroPythonDevice.sendControl`) and the PRELOAD share the exact
 * same line builder + sentinel — see that file for the protocol docs.
 */

export {
  CONTROL_SENTINEL,
  buildControlLine,
  isControl,
  buildTeleopPayload
} from '../../../shared/control'
