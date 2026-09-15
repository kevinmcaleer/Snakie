import { useCallback, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { BLOCKS_STARTERS, EMPTY_WORKSPACE, buildBlocksDocument } from '../lib/blocks/starters'
import type { BlocksWorkspace } from '../../../shared/blocks-doc'
import './BlocksStart.css'

/**
 * THE WAY IN (#1013, epic #1007).
 * =============================================================================
 *
 * What the Blocks workspace shows when nothing is open. Before this there was
 * nothing to show and no way forward: a blocks program is a `.py` with a
 * workspace in its footer (#1008), the `+` button makes an ordinary empty `.py`,
 * and an ordinary `.py` opens in Monaco — so picking **Blocks** and pressing `+`
 * got you the text editor, in the blocks workspace, with no hint that anything
 * was missing. This is the missing door.
 *
 * TWO BUTTONS, AND THE ORDER MATTERS. **Draw a square** comes first, because a
 * beginner's first minute should be something that already works and which they
 * then take apart — an empty canvas and a toolbox is a blank page, and a blank
 * page is where people stop. **A new blocks program** is second, for the second
 * time and for everyone who knows what they want.
 *
 * The buffer is UNSAVED, like every other new file here: Save asks where it goes.
 * That is deliberate — a starter that silently wrote `square.py` into whichever
 * folder happened to be open would be a tool putting files in people's projects
 * without asking.
 */
export default function BlocksStart(): JSX.Element {
  const { openBuffer } = useWorkspace()
  // Building a starter pulls the Blockly chunk, so there is a real moment
  // between the click and the canvas. Say so, and don't let a second click
  // start a second download.
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(
    (key: string, name: string, workspace: BlocksWorkspace): void => {
      if (busy) return
      setBusy(key)
      setError(null)
      void (async (): Promise<void> => {
        try {
          openBuffer(name, await buildBlocksDocument(workspace))
        } catch (err) {
          // A failure here means the generator or Blockly did not load. Saying
          // so beats a button that does nothing when you press it.
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(null)
        }
      })()
    },
    [busy, openBuffer]
  )

  return (
    <div className="editor-host">
      <div className="editor-empty blocks-start">
        <div className="blocks-start__card">
          <h2 className="blocks-start__title">Start with blocks</h2>
          <p className="blocks-start__lead">
            Snap blocks together and watch Snakie write the MicroPython beside them. No board
            needed — it runs in the simulator too.
          </p>
          <div className="blocks-start__actions">
            {BLOCKS_STARTERS.map((starter) => (
              <button
                key={starter.name}
                type="button"
                className="blocks-start__button blocks-start__button--primary"
                disabled={busy !== null}
                onClick={() => start(starter.name, starter.name, starter.workspace)}
              >
                <span className="blocks-start__button-title">
                  {busy === starter.name ? 'Opening…' : starter.title}
                </span>
                <span className="blocks-start__button-hint">{starter.description}</span>
              </button>
            ))}
            <button
              type="button"
              className="blocks-start__button"
              disabled={busy !== null}
              onClick={() => start('new', 'untitled.py', EMPTY_WORKSPACE)}
            >
              <span className="blocks-start__button-title">
                {busy === 'new' ? 'Opening…' : 'New blocks program'}
              </span>
              <span className="blocks-start__button-hint">An empty canvas to build on.</span>
            </button>
          </div>
          {error && (
            <p className="blocks-start__error" role="alert">
              Couldn’t open that: {error}
            </p>
          )}
          <p className="blocks-start__foot">
            A blocks program is an ordinary <code>.py</code> file — it runs, saves and shares like
            any other.
          </p>
        </div>
      </div>
    </div>
  )
}
