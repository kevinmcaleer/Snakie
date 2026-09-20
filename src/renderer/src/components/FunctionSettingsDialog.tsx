import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './FunctionSettingsDialog.css'

/**
 * FUNCTION SETTINGS — ONE PLACE FOR THE THINGS AROUND THE `def` (A4, #1218).
 * =============================================================================
 *
 * A function has three kinds of setting on it and, until this dialog, three
 * different places to set them:
 *
 *  - its PARAMETERS, in Blockly's own mutator bubble;
 *  - its EXTRA parameters — a default, a `*args`, a `**kwargs` (#1134) — in a
 *    hidden text row revealed from the right-click menu; and
 *  - its DECORATORS (#1215), which had no editing UI at all.
 *
 * The last two are the ones that are text, and the ones a learner has to be
 * told exist. They belong together, which is what this dialog is: the block's
 * right-click **Function settings…**, with the old *Add extra parameters…*
 * kept as a shortcut into the same place, opening on the extras box.
 *
 * WHAT IT DOES NOT TOUCH is the parameter list itself. Blockly's mutator owns
 * it — the names are workspace variables and renaming one renames every caller
 * — and re-implementing that here would be trading working machinery for a
 * second, worse copy of it. The dialog says where that lives instead.
 *
 * A REACT MODAL, not a Blockly mutator bubble: `window.prompt` is dead in
 * Electron's renderer, a bubble cannot hold a list with add/remove buttons
 * without a whole sub-workspace of blocks, and the app already dresses its
 * dialogs in the Soft Shell tokens.
 */

export interface FunctionSettingsDraft {
  /** Decorator entries, in order, WITHOUT the leading `@`. */
  decorators: string[]
  /** The extra-parameter text, exactly as it is appended to the signature. */
  extras: string
}

interface FunctionSettingsDialogProps {
  /** The function's name, for the title — so the dialog says what it is editing. */
  name: string
  /** Does this block carry a decorator list? The method and `def` blocks do. */
  canDecorate: boolean
  /** Does this block carry an extra-parameters row? Only the `def` blocks do. */
  canExtras: boolean
  /** What the block holds now. */
  value: FunctionSettingsDraft
  /** Which section opens focused — the extras shortcut asks for `extras`. */
  focus?: 'decorators' | 'extras'
  onSave: (draft: FunctionSettingsDraft) => void
  onClose: () => void
}

/** The decorators a MicroPython program actually reaches for, offered as chips. */
const SUGGESTIONS = ['property', 'staticmethod', 'classmethod', 'micropython.native']

export function FunctionSettingsDialog({
  name,
  canDecorate,
  canExtras,
  value,
  focus = 'decorators',
  onSave,
  onClose
}: FunctionSettingsDialogProps): JSX.Element {
  // A row per entry, plus the one being typed into: an empty string is a real
  // row here and is dropped on save, which is what makes "Add a decorator"
  // able to give them somewhere to type before there is anything to store.
  const [decorators, setDecorators] = useState<string[]>(value.decorators)
  const [extras, setExtras] = useState(value.extras)
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  const extrasRef = useRef<HTMLInputElement>(null)
  const firstDecoratorRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const target =
      focus === 'extras' || !canDecorate ? extrasRef.current : firstDecoratorRef.current
    target?.focus()
    target?.select()
  }, [focus, canDecorate])

  const setAt = useCallback((index: number, text: string): void => {
    setDecorators((list) => list.map((entry, i) => (i === index ? text : entry)))
  }, [])

  const removeAt = useCallback((index: number): void => {
    setDecorators((list) => list.filter((_, i) => i !== index))
  }, [])

  const move = useCallback((index: number, by: number): void => {
    setDecorators((list) => {
      const to = index + by
      if (to < 0 || to >= list.length) return list
      const next = [...list]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }, [])

  const save = useCallback((): void => {
    onSave({ decorators, extras })
  }, [decorators, extras, onSave])

  return (
    <div
      className="fnset-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="fnset"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fnset-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <h2 className="fnset__title" id="fnset-title">
          Settings for <code>{name}</code>
        </h2>

        {canDecorate && (
          <section className="fnset__section">
            <h3 className="fnset__heading">Decorators</h3>
            <p className="fnset__hint">
              Written as <code>@…</code> lines above the <code>def</code>, in this order. Leave the{' '}
              <code>@</code> off — <code>property</code>, <code>micropython.native</code>,{' '}
              <code>app.route(&quot;/&quot;)</code>.
            </p>
            {decorators.length === 0 && (
              <p className="fnset__empty">No decorators. Most functions need none.</p>
            )}
            <ul className="fnset__list">
              {decorators.map((entry, index) => (
                // Keyed by POSITION: the text is what is being edited, so a
                // key made from it would remount the input on every keystroke
                // and the caret would jump to the end.
                <li className="fnset__row" key={index}>
                  <span className="fnset__at" aria-hidden="true">
                    @
                  </span>
                  <input
                    ref={index === 0 ? firstDecoratorRef : undefined}
                    className="fnset__input fnset__input--code"
                    type="text"
                    value={entry}
                    aria-label={`Decorator ${index + 1}`}
                    placeholder="property"
                    onChange={(e) => setAt(index, e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost fnset__icon"
                    title="Move up"
                    aria-label={`Move decorator ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost fnset__icon"
                    title="Move down"
                    aria-label={`Move decorator ${index + 1} down`}
                    disabled={index === decorators.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost fnset__icon"
                    title="Remove"
                    aria-label={`Remove decorator ${index + 1}`}
                    onClick={() => removeAt(index)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="fnset__adders">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setDecorators((list) => [...list, ''])}
              >
                Add a decorator
              </button>
              {SUGGESTIONS.filter((s) => !decorators.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn btn--ghost fnset__chip"
                  onClick={() => setDecorators((list) => [...list, s])}
                >
                  @{s}
                </button>
              ))}
            </div>
          </section>
        )}

        {canExtras && (
          <section className="fnset__section">
            <h3 className="fnset__heading">Extra parameters</h3>
            <p className="fnset__hint">
              Added after the parameters above — the ones the block&rsquo;s parameter list
              can&rsquo;t hold: a default (<code>times=3</code>), a <code>*args</code>, a{' '}
              <code>**kwargs</code>. Written exactly as typed.
            </p>
            <input
              ref={extrasRef}
              className="fnset__input fnset__input--code fnset__input--wide"
              type="text"
              value={extras}
              aria-label="Extra parameters"
              placeholder="times=3, **kwargs"
              onChange={(e) => setExtras(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  save()
                }
              }}
            />
          </section>
        )}

        <p className="fnset__note">
          The parameter names themselves live on the block&rsquo;s own blue cog, because renaming
          one there renames it everywhere the function is called.
        </p>

        <div className="fnset__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
