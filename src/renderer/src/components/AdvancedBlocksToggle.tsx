import type { BlockLevel } from '../lib/blocks/registry'

/**
 * THE IN-TOOLBOX "SHOW ADVANCED BLOCKS" TOGGLE (#1211, epic #1206).
 * ===========================================================================
 *
 * The same `snakie.blocks.level` preference as Settings ▸ Appearance ▸ Advanced
 * blocks (#1210) — one store, so the two are never out of step — put where the
 * question is actually asked. A learner who cannot find `try` is looking at the
 * drawers, not at a settings dialog three menus away, and a setting nobody can
 * find is a setting nobody turns on.
 *
 * It lives at the FOOT OF THE SHELF, under a divider that closes the list of
 * categories — the toolbox column is where the drawers are, so that is where
 * the switch that changes what is in them belongs. Blockly has no slot for a
 * control of ours, so the canvas appends one to the toolbox div and portals
 * this into it; with no toolbox to sit in it falls back to floating over the
 * bottom-left corner of the canvas.
 *
 * ITS OWN MODULE, not a helper inside `BlocksCanvas`: the canvas pulls Blockly
 * (and, through the panes around it, Monaco) in with it, and the press handling
 * below is worth a unit test that does not need either. Its styles live beside
 * the rest of the canvas's in `BlocksCanvas.css`.
 */
export function AdvancedBlocksToggle({
  level,
  onChange,
  inShelf = false
}: {
  level: BlockLevel
  onChange: (level: BlockLevel) => void
  inShelf?: boolean
}): JSX.Element {
  const on = level === 'advanced'
  return (
    <label
      className={`blocks-advanced${inShelf ? ' is-in-shelf' : ''}${on ? ' is-on' : ''}`}
      /*
       * SITTING IN THE SHELF MUST NOT MEAN BEING PART OF IT (#1211).
       *
       * The switch is a child of `.blocklyToolbox`, and Blockly treats a press
       * anywhere in that column as toolbox business — twice over:
       *
       *  - `Toolbox.attachEvents_` binds `pointerdown` on the column, so the
       *    press bubbles into `Toolbox.onClick_` — stopped natively on the
       *    shelf foot, where the canvas builds it, since React's own listeners
       *    sit on the app root, ABOVE Blockly's, and cannot stop it from here.
       *  - Worse, the browser's own mousedown default walks up from the span
       *    the learner actually hit to the nearest focusable ancestor, which is
       *    the toolbox div (Blockly makes its root tabbable). Focusing the root
       *    of a focus tree sends Blockly through `getRestoredFocusableNode`,
       *    which selects THE FIRST SELECTABLE CATEGORY — Turtle — and opens its
       *    flyout. Flipping "show advanced blocks" appeared to click Turtle.
       *
       * That default is what this handler cancels — a default action still
       * belongs to the event after React has bubbled it to the root, so this
       * is the one half the component can fix itself. The checkbox still
       * toggles (label activation happens on `click`, not `mousedown`) and Tab
       * still reaches it, which is the only focus route we want.
       */
      onMouseDown={(e) => e.preventDefault()}
      title={
        on
          ? 'Hide the advanced blocks — classes, try, comprehensions, slices, files and the grey Python blocks. Your program is not changed.'
          : 'Show the advanced blocks — classes, try, comprehensions, slices, files and the grey Python blocks.'
      }
    >
      <input
        type="checkbox"
        className="blocks-advanced__input"
        checked={on}
        onChange={(e) => onChange(e.target.checked ? 'advanced' : 'simple')}
      />
      <span className="blocks-advanced__switch" aria-hidden="true" />
      <span className="blocks-advanced__label">Show advanced blocks</span>
    </label>
  )
}
