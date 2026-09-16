import type * as Blockly from 'blockly/core'
import { checkPython, type PythonContext } from './python-check'
import { PYTHON_STATEMENT, PYTHON_VALUE, rawPython } from './palette/python'

/**
 * THE SYNTAX BADGE (#1018, epic #1007).
 * =============================================================================
 *
 * "Checked, not trusted." The escape hatches put whatever a learner types
 * straight into their program — that is the point — so the typing has to be
 * looked at somewhere, and the block is the only place where the answer means
 * anything. A missing bracket becomes a sentence on the block that has it,
 * before Run, instead of a `SyntaxError` from a board naming a line number in a
 * file the learner never wrote.
 *
 * ITS OWN WARNING CHANNEL. Blockly keys warnings by id, so this sits alongside
 * #1012's pin conflicts (the default channel) and #1015's runtime errors
 * (`snakie-error`) without any of the three erasing the others — which matters,
 * because a raw block with a typo is exactly the block most likely to raise.
 *
 * Clearing matters as much as setting: a warning that outlives its cause teaches
 * a learner to ignore warnings.
 */

/** The warning channel a syntax problem uses. */
export const SYNTAX_WARNING = 'snakie-syntax'

/** Which raw-Python blocks there are, and what their text has to be. */
const CONTEXTS: Record<string, PythonContext> = {
  [PYTHON_STATEMENT]: 'statement',
  [PYTHON_VALUE]: 'expression'
}

/** Every raw-Python block's problem, keyed by block id. Blocks with none are absent. */
export function pythonProblems(workspace: Blockly.Workspace): Map<string, string> {
  const out = new Map<string, string>()
  for (const block of workspace.getAllBlocks(false)) {
    const context = CONTEXTS[block.type]
    if (!context) continue
    const problem = checkPython(rawPython(block), context)
    if (problem) out.set(block.id, problem.message)
  }
  return out
}

/** Put the badges on, and take off the ones that no longer apply. */
export function applyPythonWarnings(workspace: Blockly.Workspace): void {
  const problems = pythonProblems(workspace)
  for (const block of workspace.getAllBlocks(false)) {
    if (!CONTEXTS[block.type]) continue
    block.setWarningText(problems.get(block.id) ?? null, SYNTAX_WARNING)
  }
}
