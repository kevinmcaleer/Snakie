import * as Blockly from 'blockly/core'

/**
 * WORDING (#1011, epic #1007).
 * =============================================================================
 *
 * Blockly's stock blocks carry Blockly's stock English, which was written for a
 * general-purpose block editor rather than for a child's first hour with a
 * microcontroller. Most of it is fine. This is the short list where the block
 * face and the line it generates were saying different things.
 *
 * Deliberately short. Rewording for its own sake would make every future Blockly
 * upgrade a merge conflict with no reader any better off, and the stock text has
 * been through more classrooms than we have.
 */
export function installBlockMessages(): void {
  // "create text with" describes what Blockly's Python generator does —
  // building a string by concatenation. Ours generates an f-string, so the face
  // said one thing and the mirror showed another. "join" is also the word a
  // learner will meet next, in `' '.join(...)`.
  Blockly.Msg['TEXT_JOIN_TITLE_CREATEWITH'] = 'join'
}
