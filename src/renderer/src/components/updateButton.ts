import type { UpdateStatus } from '../../../preload/index.d'

/**
 * The GitHub "latest release" page, offered as a manual-download fallback when
 * the in-app updater can't self-install (issue #90). Opened via
 * `window.api.openExternal`.
 */
export const RELEASES_URL = 'https://github.com/kevinmcaleer/Snakie/releases/latest'

/**
 * Map a raw update-error string onto a short, friendly message for the user
 * (issue #90). electron-updater / Squirrel.Mac surface low-level errors verbatim
 * — most usefully the code-signature rejection you get when a published build
 * isn't validly signed + notarized (e.g. "Code signature at URL … did not pass
 * validation: code has no resources but signature indicates they must be
 * present"). We never show that raw string as the primary message; instead we
 * detect the signature phrasing and explain it, and fall back to a generic
 * "couldn't install the update" line for anything else.
 *
 * Side-effect-free and exported so it can be unit-tested without rendering.
 *
 * @param raw the `UpdateStatus.message` from the `error` push, if any.
 */
export function friendlyUpdateError(raw: string | undefined): string {
  const text = (raw ?? '').toLowerCase()
  const isSignature =
    text.includes('did not pass validation') ||
    text.includes('code signature') ||
    text.includes('code has no resources') ||
    text.includes('not signed') ||
    text.includes('code object is not signed')
  if (isSignature) {
    return "This build can't auto-install (it isn't signed for updates). Download the latest release manually."
  }
  return "Couldn't install the update automatically. You can download the latest release manually."
}

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
      // Subtle failure: keep the thin bar compact by falling back to the short
      // version text (never the long raw error, which would blow out the bar —
      // issue #90). The tooltip carries a friendly explanation; the dismissible
      // notifier banner offers the full text + a manual-download action.
      return {
        label: versionLabel || 'Update failed',
        action: null,
        title: friendlyUpdateError(status.message),
        isUpdate: true,
        clickable: false
      }
    default:
      return plain
  }
}
