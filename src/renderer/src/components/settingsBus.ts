import type { SettingsTab } from './SettingsDialog'

/**
 * Settings open bus (issue #83)
 * =============================
 *
 * A tiny window-CustomEvent seam so any component can request the Settings
 * dialog open on a specific tab without prop-drilling a callback through the
 * tree. {@link AppShell} owns the dialog and listens for {@link OPEN_SETTINGS_EVENT};
 * the chat panel's ⚙ button fires {@link openSettings}('chat') to deep-link the
 * Chat tab, while the toolbar gear opens the Editor tab directly.
 */

/** Window event name carrying the {@link SettingsTab} to open. */
export const OPEN_SETTINGS_EVENT = 'snakie:open-settings'

/** Request the Settings dialog open on `tab` (default: editor). */
export function openSettings(tab: SettingsTab = 'editor'): void {
  window.dispatchEvent(new CustomEvent<SettingsTab>(OPEN_SETTINGS_EVENT, { detail: tab }))
}
