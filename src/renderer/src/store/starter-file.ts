/**
 * THE STARTER FILE — what a brand-new user sees instead of an empty editor.
 *
 * Snakie reopens last session's tabs on launch, and with none to reopen it
 * showed "Open a file to start editing": correct for someone who closed
 * everything on purpose, a dead end for someone opening Snakie for the first
 * time. The first launch that ends with no tabs now opens one small program
 * that runs as it is — on the simulated board too — so Run does something.
 *
 * It stays on offer until the user has DONE something, remembered under
 * `STARTER_KEY`: a launch that restores files or opens a shared link settles it,
 * and so does editing the starter, closing it, or opening anything else. An
 * untouched starter comes back on the next launch (unsaved buffers are not
 * restored, and a first-timer who reloads should not meet an empty editor);
 * once settled it never returns, so closing it is enough to be rid of it.
 *
 * The tab is an ordinary unsaved buffer: nothing is written to disk or to the
 * board until the user saves it.
 */

export const STARTER_KEY = 'snakie.starter.v1'
export const STARTER_NAME = 'main.py'

// Comment lines are short on purpose: they must fit a phone's editor.
export const STARTER_CODE = `# Welcome to Snakie!
#
# This blinks the board's LED.
# Press Run to try it. No board?
# It runs on the simulated one.
#
# Change 0.5 to set the speed.

from machine import Pin
from time import sleep

led = Pin("LED", Pin.OUT)

while True:
    led.toggle()
    print("LED on" if led.value() else "LED off")
    sleep(0.5)
`

type StarterStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Is this install past needing the starter? (Unreadable storage counts as
 *  yes: better no starter than one that can never be dismissed.) */
export function starterSettled(storage: StarterStorage): boolean {
  try {
    return storage.getItem(STARTER_KEY) !== null
  } catch {
    return true
  }
}

/** Record that this install no longer needs the starter. False when that could
 *  not be written. */
export function settleStarter(storage: StarterStorage): boolean {
  try {
    storage.setItem(STARTER_KEY, '1')
    return true
  } catch {
    return false
  }
}

/** Does the address carry an "Open in Snakie" link? Its file is the user's
 *  first tab, so the starter stays out of the way. */
export function hasOpenLink(search: string, hash: string): boolean {
  const q = new URLSearchParams(search)
  if (q.has('gist') || q.has('repo') || q.has('name')) return true
  return /(^#|&)(src|code)=/.test(hash)
}

/**
 * The decision for this launch, once the session restore has finished (pure).
 * `openTabs` is how many tabs the restore left open.
 */
export function shouldOpenStarter(opts: {
  settled: boolean
  openTabs: number
  openLink: boolean
}): boolean {
  return !opts.settled && opts.openTabs === 0 && !opts.openLink
}

/** Is the starter still the only tab, exactly as it was opened? (pure) */
export function starterUntouched(
  files: readonly { name: string; path: string; dirty: boolean }[]
): boolean {
  if (files.length !== 1) return false
  const [f] = files
  return f.name === STARTER_NAME && f.path === '' && !f.dirty
}
