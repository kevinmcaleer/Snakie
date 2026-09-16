import { useCallback, useState, type JSX } from 'react'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { BLOCKS_STARTERS } from '../lib/blocks/starters'
import './BlocksStarterCard.css'

/**
 * THE BUNDLED BLOCKS PROJECTS, IN THE GALLERY (#1016, epic #1007).
 * =============================================================================
 *
 * #1013 put the starters where a learner already in the Blocks workspace would
 * find them — its empty state. This puts them where a learner who has just
 * opened Snakie is actually looking: the Learn gallery, beside the demo robot
 * and the courses.
 *
 * The two are the same starters from the same list, so adding one adds it in
 * both places. That is the point of the list.
 *
 * It SWITCHES to Blocks, unlike the graduation notice which only offers — here
 * the user pressed a button labelled "draw a square in blocks", so the blocks
 * workspace is what they asked for.
 */
export function BlocksStarterCard(): JSX.Element {
  const { openBuffer } = useWorkspace()
  const { switchWorkspace } = useWorkspaceLayout()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(
    (name: string, workspace: unknown): void => {
      if (busy) return
      setBusy(name)
      setError(null)
      void (async (): Promise<void> => {
        try {
          // The generator (and Blockly) load on demand — the gallery is on the
          // initial screen and must not pull a 1.1MB chunk to render a button.
          const { buildBlocksDocument } = await import('../lib/blocks/starters')
          openBuffer(name, await buildBlocksDocument(workspace as never))
          switchWorkspace('blocks')
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(null)
        }
      })()
    },
    [busy, openBuffer, switchWorkspace]
  )

  return (
    <section className="blocks-starter-card" aria-label="Start with blocks">
      <div className="blocks-starter-card__head">
        <span className="blocks-starter-card__emoji" aria-hidden="true">
          🧩
        </span>
        <div>
          <h2 className="blocks-starter-card__title">Start with blocks</h2>
          <p className="blocks-starter-card__sub">
            Snap blocks together and watch Snakie write the MicroPython beside them. No board
            needed — it runs in the simulator.
          </p>
        </div>
      </div>
      <div className="blocks-starter-card__actions">
        {BLOCKS_STARTERS.map((starter) => (
          <button
            key={starter.name}
            type="button"
            className="blocks-starter-card__button"
            disabled={busy !== null}
            onClick={() => start(starter.name, starter.workspace)}
          >
            {busy === starter.name ? 'Opening…' : starter.title}
          </button>
        ))}
      </div>
      {error && (
        <p className="blocks-starter-card__error" role="alert">
          Couldn&rsquo;t open that: {error}
        </p>
      )}
    </section>
  )
}
