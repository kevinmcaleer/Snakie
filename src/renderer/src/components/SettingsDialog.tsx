import { useEffect } from 'react'
import {
  useEditorSettings,
  MIN_LINE_SPACING,
  MAX_LINE_SPACING,
  type EditorPaper
} from '../store/settings'
import './SettingsDialog.css'

/**
 * SETTINGS DIALOG (issues #80, #81)
 * ================================
 *
 * A modal for the cream ruled-paper editor preferences:
 *  - Paper: ruled `Lines`, subtle squared `Dots`, or `Off` (#80).
 *  - Line spacing: px between ruled lines, shown live (#81).
 *
 * Both are read from / written to the {@link useEditorSettings} store, which
 * persists them and applies them to the document root — so changes preview
 * instantly behind the dialog and survive restarts.
 *
 * Closes on the Close button, a click on the backdrop, or Escape.
 */
const PAPER_OPTIONS: { value: EditorPaper; label: string; hint: string }[] = [
  { value: 'lines', label: 'Lines', hint: 'Ruled notebook lines' },
  { value: 'dots', label: 'Dots', hint: 'Subtle squared grid' },
  { value: 'off', label: 'Off', hint: 'Plain paper' }
]

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { paper, lineSpacing, setPaper, setLineSpacing } = useEditorSettings()

  // Escape closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="settings-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="settings-dialog"
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
            Space between the ruled lines (also the editor line height).
          </p>
          <input
            type="range"
            className="settings-range"
            min={MIN_LINE_SPACING}
            max={MAX_LINE_SPACING}
            step={1}
            value={lineSpacing}
            disabled={paper === 'off'}
            onChange={(e) => setLineSpacing(Number(e.target.value))}
            aria-label="Line spacing in pixels"
          />
          <div className="settings-range__scale" aria-hidden="true">
            <span>{MIN_LINE_SPACING}</span>
            <span>{MAX_LINE_SPACING}</span>
          </div>
        </section>

        <p className="settings-dialog__foot">Changes are saved automatically.</p>
      </div>
    </div>
  )
}
