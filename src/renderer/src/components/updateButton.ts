import type { UpdateStatus } from '../../../preload/index.d'

/**
 * Which renderer-side `window.api.updates` call an update control invokes when
 * clicked. `null` means the control is non-interactive in that state.
 */
export type UpdateAction = 'download' | 'quitAndInstall' | null

/**
 * Pure mapping from an update lifecycle status (plus the resolved app version)
 * to the status-bar version-slot view model. Kept side-effect-free and exported
 * so it can be unit-tested without rendering React (issue #74).
 *
 * The version slot is *update-aware*: with no/idle update it shows `v<version>`;
 * as the lifecycle advances it becomes an actionable button (download → restart)
 * or a passive progress label.
 */
export interface UpdateButtonView {
  /** The visible text. */
  label: string
  /** The `window.api.updates` method to call on click, or null if passive. */
  action: UpdateAction
  /** A tooltip describing the control. */
  title: string
  /** Whether this is the actionable "update" affordance vs the plain version. */
  isUpdate: boolean
  /** Whether the control should render as an enabled button. */
  clickable: boolean
}

/**
 * Compute the version-slot view for the status bar.
 *
 * @param status latest {@link UpdateStatus} push, or null if none yet.
 * @param version resolved app version (no leading `v`), or '' if not loaded.
 */
export function updateButtonView(
  status: UpdateStatus | null,
  version: string
): UpdateButtonView {
  const versionLabel = version ? `v${version}` : ''
  const plain: UpdateButtonView = {
    label: versionLabel,
    action: null,
    title: 'Snakie version',
    isUpdate: false,
    clickable: false
  }

  if (!status) return plain

  switch (status.state) {
    case 'available':
      return {
        label: status.version ? `⬆ Update to v${status.version}` : '⬆ Update available',
        action: 'download',
        title: 'Download and install the new version',
        isUpdate: true,
        clickable: true
      }
    case 'downloading':
      return {
        label:
          typeof status.percent === 'number'
            ? `Downloading… ${status.percent}%`
            : 'Downloading…',
        action: null,
        title: 'Downloading the update',
        isUpdate: true,
        clickable: false
      }
    case 'downloaded':
      return {
        label: status.version ? `Restart for v${status.version}` : 'Restart to update',
        action: 'quitAndInstall',
        title: 'Restart to install the downloaded update',
        isUpdate: true,
        clickable: true
      }
    case 'error':
      // Subtle failure: fall back to the version text but flag it + tooltip.
      return {
        label: versionLabel || 'Update failed',
        action: null,
        title: `Update failed${status.message ? `: ${status.message}` : ''}`,
        isUpdate: true,
        clickable: false
      }
    default:
      return plain
  }
}
