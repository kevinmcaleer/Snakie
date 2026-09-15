import type { BlocksWorkspace } from '../../../../shared/blocks-doc'

/**
 * SOMEWHERE TO START (#1013, epic #1007).
 * =============================================================================
 *
 * Until this module, there was **no way to make a blocks program in Snakie**.
 * That is not an exaggeration: #1008 decided a blocks program is a `.py` with a
 * serialised workspace in a footer comment, and `EditorArea` opens the canvas
 * for exactly those files — so a brand-new `untitled.py` from the `+` button is
 * an ordinary Python file that opens in Monaco, in the Blocks workspace as
 * much as anywhere else. Every blocks file that existed was one a test wrote.
 *
 * The epic's definition of done begins *"a ten-year-old can open Snakie, pick
 * Blocks, drag forward 100 / turn right 90 four times"*. They cannot, unless
 * something makes them a canvas to drag onto. This is that something:
 *
 *  - **A new blocks program** — an empty canvas, the blocks equivalent of `+`.
 *  - **Draw a square** — the bundled starter the issue asks for, which is also
 *    the first lesson, the demo, and what the screenshots should show. It opens
 *    with the four blocks already assembled, because a beginner's first
 *    encounter with a tool should be something that WORKS which they then take
 *    apart, not an empty rectangle and a toolbox.
 *
 * WHY THE WORKSPACE JSON AND NOT A COMMITTED `.py`. A starter file with the
 * generated code baked in would be a second copy of the generator's output,
 * frozen at the moment it was written, quietly drifting every time the generator
 * improved — and drift here means a starter that opens with a hand-edit conflict
 * warning on it. Keeping only the workspace and generating the code on demand
 * means the starter cannot disagree with the generator, ever. The cost is that
 * building one needs the Blockly chunk, which is why {@link buildBlocksDocument}
 * is async: it dynamically imports the generator, so the 1.1MB canvas bundle
 * still isn't downloaded until someone actually asks for blocks.
 */

/** A blocks program somebody can start from. */
export interface BlocksStarter {
  /** The filename the buffer opens under. */
  name: string
  /** The button's label. */
  title: string
  /** One line under the label. */
  description: string
  /** The workspace itself — Blockly's own serialisation format. */
  workspace: BlocksWorkspace
}

/** A canvas with nothing on it. */
export const EMPTY_WORKSPACE: BlocksWorkspace = { blocks: { languageVersion: 0, blocks: [] } }

/**
 * The square.
 *
 * `repeat 4 [ forward 100, turn right 90 ]` — four blocks, and the only program
 * that is simultaneously the smallest thing worth drawing, an introduction to a
 * loop, and a shape a child can predict before pressing Run. It needs no
 * hardware, so it runs in the simulator on a school Chromebook.
 *
 * The numbers are shadows, not real blocks, so a learner can drag their own
 * value in over the top without first deleting anything — the same trick the
 * flyout uses.
 */
export const SQUARE_STARTER: BlocksStarter = {
  name: 'square.py',
  title: 'Draw a square',
  description: 'Four blocks, a loop, and no hardware needed.',
  workspace: {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'controls_repeat_ext',
          id: 'starter-repeat',
          x: 40,
          y: 40,
          inputs: {
            TIMES: { shadow: { type: 'math_number', id: 'starter-times', fields: { NUM: 4 } } },
            DO: {
              block: {
                type: 'snakie_turtle_forward',
                id: 'starter-forward',
                inputs: {
                  STEPS: {
                    shadow: { type: 'math_number', id: 'starter-steps', fields: { NUM: 100 } }
                  }
                },
                next: {
                  block: {
                    type: 'snakie_turtle_right',
                    id: 'starter-right',
                    inputs: {
                      ANGLE: {
                        shadow: { type: 'math_number', id: 'starter-angle', fields: { NUM: 90 } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      ]
    }
  }
}

/** Every bundled starter, in the order they are offered. */
export const BLOCKS_STARTERS: readonly BlocksStarter[] = Object.freeze([SQUARE_STARTER])

/**
 * Turn a workspace into the text of a blocks `.py` — generated code plus footer.
 *
 * Async because it loads the generator (and therefore Blockly) on demand: the
 * placeholder offering these buttons is in the main bundle, and pulling the
 * canvas chunk into it to build a file nobody has asked for yet would make the
 * app slower to start for everyone who never opens blocks.
 *
 * Returns the empty string's document for an empty workspace, which is correct:
 * a new blocks program is a file with a footer and no code yet.
 */
export async function buildBlocksDocument(workspace: BlocksWorkspace): Promise<string> {
  const [{ generateProgram }, { installCorePalette }, { installBlockDefinitions }, Blockly, doc] =
    await Promise.all([
      import('./generator'),
      import('./palette'),
      import('./registry'),
      import('blockly/core'),
      import('../../../../shared/blocks-doc')
    ])
  // The canvas does this on mount too, and both are idempotent — but a starter
  // can be built before any canvas has ever existed, which is the whole point.
  installCorePalette()
  installBlockDefinitions()
  await import('./locale').then((m) => m.ensureBlocklyLocale())

  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  const { code } = generateProgram(ws)
  // Re-serialise rather than using the literal above: Blockly normalises a
  // workspace on load (default fields, ordering), and the footer must hold what
  // the canvas will produce on its first change — otherwise merely OPENING the
  // starter marks it dirty, the bug #1009 had to fix once already.
  return doc.writeBlocksFooter(code, Blockly.serialization.workspaces.save(ws) as BlocksWorkspace)
}
