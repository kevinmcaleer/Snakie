import { describe, expect, it } from 'vitest'
import { updateButtonView } from '../src/renderer/src/components/updateButton'

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

  it('falls back to the version on error, with the message in the tooltip', () => {
    const v = updateButtonView({ state: 'error', message: 'boom' }, '1.2.3')
    expect(v.label).toBe('v1.2.3')
    expect(v.action).toBeNull()
    expect(v.clickable).toBe(false)
    expect(v.title).toContain('boom')
  })

  it('shows "Update failed" on error when no version is loaded', () => {
    expect(updateButtonView({ state: 'error', message: 'boom' }, '').label).toBe('Update failed')
  })
})
