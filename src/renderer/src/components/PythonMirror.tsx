import { useMemo } from 'react'
import { highlightPython } from '../lib/blocks/python-highlight'
import './PythonMirror.css'

/**
 * THE PYTHON MIRROR (#1009, epic #1007).
 * =============================================================================
 *
 * The Python half of the blocks split: the code the blocks wrote, beside the
 * blocks that wrote it. This is the teaching mechanism of the whole epic — a
 * learner who can see the text growing as they drag is already reading it.
 *
 * A MIRROR, NOT A SECOND EDITOR. The blocks are the source of truth, so this is
 * read-only. But read-only as an AFFORDANCE, not a locked box: typing into it is
 * caught and answered with the offer to graduate the file to Python, which turns
 * the commonest accident in a split view into the milestone the epic is built
 * around. #1016 owns that conversation; what this component owes it is the
 * `onEditAttempt` seam and one element per line for the hover-linked
 * highlighting to hang off.
 *
 * NOT MONACO. Mounting a second editor to render text nobody can type into
 * would pull the editor's multi-megabyte chunk into the blocks chunk and buy an
 * editing surface we would then have to take away. The colouring is
 * `python-highlight.ts`, which only has to handle the Python we generate.
 */
export interface PythonMirrorProps {
  /** The generated MicroPython, footer already stripped. */
  code: string
  /** The user tried to type here — #1016 answers with the graduation offer. */
  onEditAttempt?: () => void
}

export function PythonMirror({ code, onEditAttempt }: PythonMirrorProps): JSX.Element {
  const lines = useMemo(() => highlightPython(code), [code])

  return (
    <div className="pymirror">
      <div className="pymirror__header">
        <span className="pymirror__title">Python</span>
        <span
          className="pymirror__badge"
          title="The blocks write this — edit the blocks to change it"
        >
          read-only
        </span>
      </div>
      <div
        className="pymirror__body"
        // Focusable and key-listening rather than inert: an inert pane gives a
        // learner no feedback at all when they try to type, and "nothing
        // happened" is the worst answer a teaching tool can give.
        tabIndex={0}
        role="textbox"
        aria-readonly="true"
        aria-label="Generated Python (read-only)"
        onKeyDown={(e) => {
          // Let navigation, copy and the browser's own shortcuts through; only
          // something that LOOKS like typing raises the offer.
          if (e.ctrlKey || e.metaKey || e.altKey) return
          if (
            e.key.length !== 1 &&
            e.key !== 'Backspace' &&
            e.key !== 'Delete' &&
            e.key !== 'Enter'
          )
            return
          e.preventDefault()
          onEditAttempt?.()
        }}
      >
        {lines.length === 0 ? (
          <p className="pymirror__empty">
            Drag a block onto the canvas and its Python appears here.
          </p>
        ) : (
          <ol className="pymirror__lines">
            {lines.map((tokens, i) => (
              // The line number is the identity #1015's tracebacks and #1016's
              // linked highlighting both address, so it is on the element rather
              // than implied by its position.
              <li className="pymirror__line" key={i} data-line={i + 1}>
                <span className="pymirror__code">
                  {tokens.map((t, j) => (
                    <span key={j} className={`pytok pytok--${t.kind}`}>
                      {t.text}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

export default PythonMirror
