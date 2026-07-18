import { useEffect, useState } from 'react'
import {
  useEditorSettings,
  MIN_LINE_SPACING,
  MAX_LINE_SPACING,
  type EditorPaper,
  type BreadboardBg
} from '../store/settings'
import { EDITOR_THEME_LIST } from '../store/editorThemes'
import { useFocusTrap } from '../hooks/useFocusTrap'
import type { Theme } from '../hooks/useTheme'
import { ChatSettings } from './ChatSettings'
import { BulbIcon } from './ui-icons'
import './SettingsDialog.css'

/**
 * SETTINGS DIALOG (issues #80, #81 — tabbed in #83/#84)
 * ====================================================
 *
 * A tabbed modal for the editor + chat preferences. Tabs are a simple keyed
 * list ({@link TABS}) so more can be added later.
 *
 *  - **Editor** — the cream ruled-paper preferences: paper mode (#80),
 *    line spacing (#81) and the editor colour theme (#84).
 *  - **Chat** — the multi-provider key settings, GitHub Copilot sign-in and the
 *    inline-autocomplete settings (moved out of the chat panel in #83).
 *
 * Editor values are read from / written to {@link useEditorSettings} (which
 * persists them and applies them to the document root, previewing instantly
 * behind the dialog). Chat values live in {@link ChatSettings}.
 *
 * `initialTab` lets the caller deep-link a tab — the toolbar gear opens
 * `editor`, the chat's ⚙ opens `chat`. Closes on the Close button, a click on
 * the backdrop, or Escape.
 */

/** Which settings tab is shown. Extend by adding to {@link TABS}. */
export type SettingsTab = 'appearance' | 'editor' | 'chat'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'chat', label: 'Chat' }
]

/** The app-wide skins (moved here from the toolbar toggle). "Light" is the
 *  textured default skin (id `skeuomorph`); the other is the dark theme. */
const THEME_OPTIONS: { value: Theme; label: string; hint: string }[] = [
  { value: 'skeuomorph', label: 'Light', hint: 'The bright default skin — brushed metal, felt and cream paper' },
  { value: 'dark', label: 'Dark', hint: 'A dark, lights-out theme' }
]

const PAPER_OPTIONS: { value: EditorPaper; label: string; hint: string }[] = [
  { value: 'lines', label: 'Lines', hint: 'Ruled notebook lines' },
  { value: 'dots', label: 'Dots', hint: 'Subtle squared grid' },
  { value: 'off', label: 'Off', hint: 'Plain paper' }
]

export function SettingsDialog({
  onClose,
  initialTab = 'editor',
  theme,
  setTheme
}: {
  onClose: () => void
  initialTab?: SettingsTab
  theme: Theme
  setTheme: (t: Theme) => void
}): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  // Move focus into the dialog on open, trap Tab, and restore it on close.
  const dialogRef = useFocusTrap<HTMLDivElement>()

  // Re-sync the active tab if the caller re-opens with a different deep link.
  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  // Escape closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-backdrop" onClick={onClose} role="presentation">
      <div
        className="settings-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-dialog__head">
          <h2 className="settings-dialog__title">Settings</h2>
          <button
            type="button"
            className="settings-dialog__close"
            onClick={onClose}
            aria-label="Close settings"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`settings-tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'appearance' ? (
          <AppearanceTab theme={theme} setTheme={setTheme} />
        ) : tab === 'editor' ? (
          <EditorTab />
        ) : (
          <ChatSettings />
        )}

        <p className="settings-dialog__foot">Changes are saved automatically.</p>
      </div>
    </div>
  )
}

/** Board View breadboard background options (#…). */
const BREADBOARD_BG_OPTIONS: { value: BreadboardBg; label: string; hint: string }[] = [
  { value: 'dark', label: 'Dark', hint: 'The default dark workbench mat' },
  { value: 'blueprint', label: 'Blueprint', hint: 'A classic blue blueprint with a light grid' }
]

/** The Appearance tab: the app-wide skin + the Board View breadboard background. */
function AppearanceTab({
  theme,
  setTheme
}: {
  theme: Theme
  setTheme: (t: Theme) => void
}): JSX.Element {
  const { breadboardBg, setBreadboardBg, showTips, setShowTips } = useEditorSettings()
  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section__title">Theme</h3>
        <p className="settings-section__hint">
          The overall Snakie skin — a bright Light theme or a dark theme.
        </p>
        <div className="settings-segment" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={theme === opt.value}
              className={`settings-segment__btn${theme === opt.value ? ' is-active' : ''}`}
              onClick={() => setTheme(opt.value)}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Breadboard background</h3>
        <p className="settings-section__hint">
          The backdrop behind the Board View wiring canvas.
        </p>
        <div className="settings-segment" role="radiogroup" aria-label="Breadboard background">
          {BREADBOARD_BG_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={breadboardBg === opt.value}
              className={`settings-segment__btn${breadboardBg === opt.value ? ' is-active' : ''}`}
              onClick={() => setBreadboardBg(opt.value)}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Status bar tips</h3>
        <p className="settings-section__hint">
          Rotate a <BulbIcon size={12} /> discovery tip through the status bar when it has nothing
          else to say.
        </p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={showTips}
            onChange={(e) => setShowTips(e.target.checked)}
          />
          <span>Show tips in the status bar</span>
        </label>
      </section>
    </>
  )
}

/** The Editor tab: notebook paper, line spacing and the editor colour theme. */
function EditorTab(): JSX.Element {
  const {
    paper,
    lineSpacing,
    editorTheme,
    checkFirmwareUpdates,
    minimap,
    setPaper,
    setLineSpacing,
    setEditorTheme,
    setCheckFirmwareUpdates,
    setMinimap
  } = useEditorSettings()

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section__title">Notebook paper</h3>
        <p className="settings-section__hint">
          Ruled lines for the cream paper editor — or a subtle squared grid of dots, or nothing.
        </p>
        <div className="settings-segment" role="radiogroup" aria-label="Notebook paper">
          {PAPER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={paper === opt.value}
              className={`settings-segment__btn${paper === opt.value ? ' is-active' : ''}`}
              onClick={() => setPaper(opt.value)}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__row">
          <h3 className="settings-section__title">Line spacing</h3>
          <span className="settings-value">{lineSpacing} px</span>
        </div>
        <p className="settings-section__hint">
          The editor line height — and the gap between ruled lines when paper is on.
        </p>
        <input
          type="range"
          className="settings-range"
          min={MIN_LINE_SPACING}
          max={MAX_LINE_SPACING}
          step={1}
          value={lineSpacing}
          onChange={(e) => setLineSpacing(Number(e.target.value))}
          aria-label="Line spacing in pixels"
        />
        <div className="settings-range__scale" aria-hidden="true">
          <span>{MIN_LINE_SPACING}</span>
          <span>{MAX_LINE_SPACING}</span>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Editor theme</h3>
        <p className="settings-section__hint">
          Syntax colours + paper for the editor. Paper themes keep the ruled lines; a dark theme
          hides them.
        </p>
        <div className="settings-segment" role="radiogroup" aria-label="Editor theme">
          {EDITOR_THEME_LIST.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={editorTheme === t.id}
              className={`settings-segment__btn${editorTheme === t.id ? ' is-active' : ''}`}
              onClick={() => setEditorTheme(t.id)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Mini-map</h3>
        <p className="settings-section__hint">
          Show the code overview mini-map down the right edge of the editor.
        </p>
        <label className="settings-check">
          <input type="checkbox" checked={minimap} onChange={(e) => setMinimap(e.target.checked)} />
          <span>Show the editor mini-map</span>
        </label>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Firmware updates</h3>
        <p className="settings-section__hint">
          Check whether a newer MicroPython is available for the connected device and prompt you from
          the Flash-firmware button.
        </p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={checkFirmwareUpdates}
            onChange={(e) => setCheckFirmwareUpdates(e.target.checked)}
          />
          <span>Check for newer MicroPython firmware</span>
        </label>
      </section>
    </>
  )
}
