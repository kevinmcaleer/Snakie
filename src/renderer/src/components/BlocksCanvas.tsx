import { useMemo } from 'react'
import { useWorkspace } from '../store/workspace'
import { parseBlocksFooter, type BlocksDoc } from '../../../shared/blocks-doc'
import './BlocksCanvas.css'

/**
 * THE BLOCK CANVAS — placeholder (#1008, epic #1007).
 * =============================================================================
 *
 * #1008 is the document model, not the canvas: Blockly itself, the Soft Shell
 * theme and the canvas/Python split land in #1009. What this file exists for
 * today is the two things the document model cannot do without a mounted
 * component:
 *
 *  1. **Prove the route.** A `.py` carrying a blocks footer opens HERE rather
 *     than in Monaco, the same way `.urdf` opens Robot View and `.csv` opens
 *     Data View in `EditorArea.tsx`. That seam is what #1009 drops Blockly into.
 *  2. **Own the hand-edit conflict.** A file whose footer no longer matches its
 *     Python has to ask which side wins before anything is written, and the
 *     asking belongs on the canvas — it is the canvas that would otherwise
 *     silently regenerate over somebody's edit.
 *
 * "Keep the Python" works now, because dropping a footer needs no generator.
 * "Keep the blocks" does not, because rebuilding the code from the workspace IS
 * the generator (#1010) — so it is described rather than offered as a button
 * that would do nothing. A dead control that pretends to work is the one thing
 * worse than an honest gap (epic #853: no stub that lies).
 */
export function BlocksCanvas(): JSX.Element {
  const { openFiles, activeId, graduateToPython } = useWorkspace()
  const file = openFiles.find((f) => f.id === activeId) ?? null
  const content = file?.content
  // Keyed on the TEXT, not the file: re-parsing on every render would inflate
  // the footer each time, and re-parsing on every tab switch would do it for a
  // buffer whose bytes have not moved.
  const doc = useMemo(() => (content === undefined ? null : parseBlocksFooter(content)), [content])

  return (
    <BlocksCanvasView
      name={file?.name ?? null}
      doc={doc}
      conflict={file?.blocksConflict === true}
      onKeepPython={file ? () => graduateToPython(file.id) : undefined}
    />
  )
}

export interface BlocksCanvasViewProps {
  /** The active file's name, or null when nothing (readable) is open. */
  name: string | null
  /** Its parsed document, or null. */
  doc: BlocksDoc | null
  /** Its Python was hand-edited under an unchanged footer. */
  conflict: boolean
  /** Resolve the conflict by keeping the code and dropping the blocks. */
  onKeepPython?: () => void
}

/**
 * The canvas as pure markup — store-free so it renders in a node test, and so
 * #1009 can replace what's inside it without unpicking the store wiring.
 */
export function BlocksCanvasView({
  name,
  doc,
  conflict,
  onKeepPython
}: BlocksCanvasViewProps): JSX.Element {
  if (!doc || !name) {
    return (
      <div className="blocks-canvas">
        <p className="blocks-canvas__note">No blocks file is open.</p>
      </div>
    )
  }

  const blocks = countBlocks(doc.workspace)

  return (
    <div className="blocks-canvas">
      {conflict && (
        <div className="blocks-canvas__conflict" role="alert">
          <h2 className="blocks-canvas__conflict-title">This file&rsquo;s Python was edited</h2>
          <p>
            The code in <strong>{name}</strong> no longer matches the blocks saved with it. Nothing
            has been changed — pick which one to keep.
          </p>
          <div className="blocks-canvas__actions">
            <button type="button" className="btn btn--sm" onClick={onKeepPython}>
              Keep the Python, drop the blocks
            </button>
          </div>
          <p className="blocks-canvas__hint">
            Keeping the blocks instead means rebuilding the Python from them, which arrives with the
            generator (#1010). Until then the edited code is safe here, and saving changes nothing.
          </p>
        </div>
      )}
      <div className="blocks-canvas__placeholder">
        <p className="blocks-canvas__note">
          {blocks === 1 ? '1 block' : `${blocks} blocks`} saved in this file.
        </p>
        <p className="blocks-canvas__hint">The block canvas arrives in #1009.</p>
      </div>
    </div>
  )
}

/**
 * How many blocks the workspace holds, counting `next` chains and nested inputs.
 *
 * Only so the placeholder can say something TRUE about the file rather than
 * "blocks file" — which is the difference between "it read my program" and "it
 * recognised the extension". Tolerant of any shape: this walks unknown JSON
 * from a file on disk, so it counts what it understands and ignores the rest.
 */
export function countBlocks(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countBlocks(v), 0)
  if (!value || typeof value !== 'object') return 0
  const node = value as Record<string, unknown>
  const self = typeof node.type === 'string' ? 1 : 0
  return Object.values(node).reduce<number>((n, v) => n + countBlocks(v), self)
}

export default BlocksCanvas
