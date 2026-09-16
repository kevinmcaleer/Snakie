import { useCallback, useState } from 'react'
import { hasBlocksFooter, stripBlocksFooter } from '../../../../shared/blocks-doc'
import { dispatchGraduated } from '../../components/editorBridge'
import { useWorkspace } from '../../store/workspace'
import { planGraduation } from './graduate'

/**
 * GRADUATING, AS ONE IMPLEMENTATION (#1016, epic #1007).
 * =============================================================================
 *
 * Four things offer this step, and they must all do the same thing:
 *
 *  - the **Graduate to Python** button in the editor header;
 *  - typing in the read-only Python mirror, which is the most natural way a
 *    learner ever says "I'm ready" and should be treated as exactly that;
 *  - the hand-edit conflict notice's "keep the Python";
 *  - the unreadable-file notice, for a file this build cannot open on a canvas.
 *
 * A hook rather than four call sites, because the ORDER matters and a copy that
 * got it wrong would lose somebody's blocks: the blocks are kept FIRST, and the
 * footer is only dropped once they are safely somewhere else.
 */
export interface Graduation {
  /** Do it. Silently does nothing for a file with no blocks to graduate. */
  graduate: () => void
  /** Why it didn't happen, when the blocks could not be kept. */
  error: string | null
  /** Forget the error — the caller dismissed it. */
  clearError: () => void
}

export function useGraduate(fileId: string | null): Graduation {
  const { openFiles, graduateToPython, openBuffer, setActive } = useWorkspace()
  const [error, setError] = useState<string | null>(null)

  const graduate = useCallback((): void => {
    const file = openFiles.find((f) => f.id === fileId)
    if (!file) return
    const plan = planGraduation(file, stripBlocksFooter, hasBlocksFooter)
    if (!plan) return
    setError(null)
    void (async (): Promise<void> => {
      // KEEP THE BLOCKS FIRST. A failure here stops the graduation rather than
      // completing it without them — the order is the whole safety property,
      // and it is why this is one function rather than four.
      try {
        if (plan.blocksPath) {
          await window.api.fs.writeFile(plan.blocksPath, plan.blocksContent)
        } else {
          // Never saved, so there is no folder to put a sibling in. A second
          // unsaved buffer keeps them without writing anywhere the user did not
          // choose — two unsaved tabs beats picking a folder on their behalf.
          openBuffer(plan.blocksName, plan.blocksContent)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return
      }
      graduateToPython(file.id)
      // THE PYTHON IS THE DESTINATION. Keeping the blocks as a second buffer
      // makes that buffer active, which would land a learner who just graduated
      // on the canvas they were leaving — the safety net in front of the thing
      // it is there to catch. Put their file back in front.
      setActive(file.id)
      // ANNOUNCED rather than rendered by the caller: the file stops being a
      // blocks file here, so the canvas and the split are about to unmount and
      // would take any notice of theirs with them.
      dispatchGraduated({
        fileId: file.id,
        name: file.name,
        lines: plan.lines,
        blocksName: plan.blocksName,
        blocksSaved: plan.blocksPath !== null
      })
    })()
  }, [fileId, openFiles, graduateToPython, openBuffer, setActive])

  return { graduate, error, clearError: useCallback(() => setError(null), []) }
}
