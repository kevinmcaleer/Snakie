import { useMemo } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { isMac } from '../lib/platform'
import { shortcutSections } from '../../../shared/shortcuts'
import './ShortcutSheet.css'

/**
 * THE KEYBOARD SHORTCUT CHEATSHEET (#920, epic #913).
 * =============================================================================
 *
 * Opened by Help ▸ Keyboard Shortcuts, or its own ⌘⇧/ — which the sheet lists
 * like any other binding, because it is one.
 *
 * NOTHING HERE KNOWS A SHORTCUT. Every row comes from `shortcutSections()`,
 * which walks the same menu template `Menu.buildFromTemplate` is handed, so the
 * sheet cannot advertise a key the menu doesn't bind (or miss one it does). Only
 * a handful exist today — the File, Tools and Device menus of #915 / #917 / #918
 * aren't built yet — and the sheet grows on its own as they land.
 *
 * The list is honestly incomplete in one way, said in the footnote rather than
 * papered over: standard-role items (Undo, Copy, Zoom, Minimise) carry no
 * accelerator in the template because Electron gives each role the platform's
 * own key. Reprinting those would mean hand-writing the second table this whole
 * design exists to avoid.
 */

interface ShortcutSheetProps {
  /** `app.name` — the heading for the macOS app menu's section. */
  appName?: string
  onClose: () => void
}

export function ShortcutSheet({ appName = 'Snakie', onClose }: ShortcutSheetProps): JSX.Element {
  const mac = isMac()
  const sections = useMemo(() => shortcutSections({ appName, isMac: mac }), [appName, mac])
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  return (
    <div
      className="shortcuts-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="shortcuts"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <div className="shortcuts__head">
          <h2 className="shortcuts__title" id="shortcuts-title">
            Keyboard shortcuts
          </h2>
          {/* The close button is the first focusable control, so the focus trap
              lands here on open and Escape/Return/Space all dismiss the sheet
              without a mouse — which a keyboard-shortcut sheet rather owes you. */}
          <button
            type="button"
            className="btn btn--ghost shortcuts__close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            Close
          </button>
        </div>

        <div className="shortcuts__body">
          {sections.map((section) => (
            <section className="shortcuts__section" key={section.title}>
              <h3 className="shortcuts__section-title">{section.title}</h3>
              {section.shortcuts.length === 0 ? (
                // An empty heading would read as a bug. Saying WHY it is empty
                // is the useful thing, and it stops being shown the moment that
                // menu gains its first accelerator.
                <p className="shortcuts__empty">
                  Nothing bound here yet &mdash; these items are click-only for now.
                </p>
              ) : (
                <dl className="shortcuts__list">
                  {section.shortcuts.map((s) => (
                    <div className="shortcuts__row" key={s.accelerator + s.label}>
                      <dt className="shortcuts__label">{s.label}</dt>
                      <dd className="shortcuts__keys">
                        <kbd className="shortcuts__kbd">{s.keys}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
        </div>

        <p className="shortcuts__foot">
          Generated from the application menu, so it can&rsquo;t drift from the real bindings. Edit
          and Window use your platform&rsquo;s standard keys, and the editor keeps its own &mdash;{' '}
          {mac ? '⌘/' : 'Ctrl+/'} to comment a line, {mac ? '⌘F' : 'Ctrl+F'} to find.
        </p>
      </div>
    </div>
  )
}
