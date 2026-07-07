/**
 * The web build's `window.api` (epic #267 Phase W1) — layers real `device`
 * (Web Worker MicroPython sim), `fs`/`robot` (OPFS/File System Access) on top
 * of {@link createInertApi}'s complete stub, so every namespace Snakie-for-Web
 * doesn't implement yet (Git, plugins, LLM, firmware, package installs,
 * detached OS windows, …) degrades explicitly instead of crashing.
 */
import type { Api } from '../../../preload/index'
import { createInertApi } from '../lib/inertApi'
import { WorkerDeviceClient } from './device/WorkerDeviceClient'
import { opfsFs } from './fs/opfsFs'
import { createOpfsRobot } from './fs/opfsRobot'

/** App version baked in at build time by `vite.web.config.ts` (falls back to
 *  `'0.0.0-web'` in dev/tests where the define isn't set). */
declare const __SNAKIE_VERSION__: string | undefined

function appVersion(): string {
  return typeof __SNAKIE_VERSION__ === 'string' ? __SNAKIE_VERSION__ : '0.0.0-web'
}

/** Build a fresh web `Api`. A factory (not a singleton) so tests can create
 *  independent instances (each with its own worker). `device` is injectable
 *  (defaults to a real `WorkerDeviceClient`, which spins up the MicroPython
 *  Worker) so tests can substitute a fake without touching `Worker`/`WASM`. */
export function createWebApi(device: Api['device'] = new WorkerDeviceClient()): Api {
  const robot = createOpfsRobot()
  const inert = createInertApi()

  const api = {
    ...inert,
    ping: (): Promise<string> => Promise.resolve('pong (web)'),
    appVersion: (): Promise<string> => Promise.resolve(appVersion()),
    diagnostics: (): Promise<{
      platform: string
      arch: string
      osVersion: string
      electron: string
      snakieVersion: string
    }> =>
      Promise.resolve({
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
        arch: 'wasm32',
        osVersion: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        electron: 'n/a (web)',
        snakieVersion: appVersion()
      }),
    device,
    fs: opfsFs,
    robot
  }

  return api as unknown as Api
}
