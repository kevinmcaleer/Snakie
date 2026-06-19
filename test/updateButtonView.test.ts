import { describe, expect, it } from 'vitest'
import {
  friendlyUpdateError,
  updateButtonView
} from '../src/renderer/src/components/updateButton'

/**
 * Unit tests for the pure `updateButtonView` helper (issue #74) that maps an
 * update lifecycle status + app version onto the status-bar version-slot view
 * model: label, the `window.api.updates` action to invoke, and whether it is an
 * actionable button.
 */
describe('updateButtonView', () => {
  it('shows the plain version when there is no update status', () => {
    const v = updateButtonView(null, '1.2.3')
    expect(v.label).toBe('v1.2.3')
    expect(v.action).toBeNull()
    expect(v.isUpdate).toBe(false)
    expect(v.clickable).toBe(false)
  })

  it('shows an empty label when neither version nor status is known', () => {
    expect(updateButtonView(null, '').label).toBe('')
  })

  it('offers a download button when an update is available', () => {
    const v = updateButtonView({ state: 'available', version: '2.0.0' }, '1.2.3')
    expect(v.label).toBe('⬆ Update to v2.0.0')
    expect(v.action).toBe('download')
    expect(v.clickable).toBe(true)
    expect(v.isUpdate).toBe(true)
  })

  it('falls back to generic available text without a version', () => {
    const v = updateButtonView({ state: 'available' }, '1.2.3')
    expect(v.label).toBe('⬆ Update available')
    expect(v.action).toBe('download')
  })

  it('shows non-clickable progress while downloading', () => {
    const v = updateButtonView({ state: 'downloading', percent: 42 }, '1.2.3')
    expect(v.label).toBe('Downloading… 42%')
    expect(v.action).toBeNull()
    expect(v.clickable).toBe(false)
  })

  it('shows a generic downloading label when percent is missing', () => {
    expect(updateButtonView({ state: 'downloading' }, '1.2.3').label).toBe('Downloading…')
  })

  it('offers a restart button once downloaded', () => {
    const v = updateButtonView({ state: 'downloaded', version: '2.0.0' }, '1.2.3')
    expect(v.label).toBe('Restart for v2.0.0')
    expect(v.action).toBe('quitAndInstall')
    expect(v.clickable).toBe(true)
  })

  it('uses a generic restart label without a version', () => {
    expect(updateButtonView({ state: 'downloaded' }, '1.2.3').label).toBe('Restart to update')
  })

  it('falls back to the version on error, keeping the bar compact', () => {
    // The thin status bar shows only the short version label on error (never the
    // long raw Squirrel string), with a friendly explanation in the tooltip so
    // the bar can never overflow (issue #90).
    const v = updateButtonView({ state: 'error', message: 'boom' }, '1.2.3')
    expect(v.label).toBe('v1.2.3')
    expect(v.action).toBeNull()
    expect(v.clickable).toBe(false)
    expect(v.title).not.toContain('boom')
    expect(v.title).toMatch(/download the latest release manually/i)
  })

  it('shows "Update failed" on error when no version is loaded', () => {
    expect(updateButtonView({ state: 'error', message: 'boom' }, '').label).toBe('Update failed')
  })
})

/**
 * Unit tests for `friendlyUpdateError` (issue #90): the raw electron-updater /
 * Squirrel.Mac error string is never shown verbatim as the primary message; the
 * code-signature rejection is detected and explained, and anything else gets a
 * generic "couldn't install" line.
 */
describe('friendlyUpdateError', () => {
  it('explains the macOS code-signature rejection', () => {
    const raw =
      'Code signature at URL file:///Applications/Snakie.app/ did not pass ' +
      'validation: code has no resources but signature indicates they must be present'
    const msg = friendlyUpdateError(raw)
    expect(msg).toMatch(/isn't signed for updates/i)
    expect(msg).toMatch(/download the latest release manually/i)
    // Never leak the raw Squirrel string into the friendly summary.
    expect(msg).not.toContain('file:///')
  })

  it('detects a generic "not signed" phrasing', () => {
    expect(friendlyUpdateError('The application is not signed')).toMatch(
      /isn't signed for updates/i
    )
  })

  it('falls back to a generic message for unrelated errors', () => {
    const msg = friendlyUpdateError('net::ERR_INTERNET_DISCONNECTED')
    expect(msg).toMatch(/couldn't install the update/i)
    expect(msg).toMatch(/download the latest release manually/i)
  })

  it('handles a missing message', () => {
    expect(friendlyUpdateError(undefined)).toMatch(/couldn't install the update/i)
  })
})
