import * as Blockly from 'blockly/core'
import * as BlocklyEn from 'blockly/msg/en'

/**
 * BLOCKLY'S MESSAGE TABLE (#1009, #1010, epic #1007).
 * =============================================================================
 *
 * `blockly/core` ships with an EMPTY `Msg`. The locale packs are separate, and
 * the umbrella `blockly` entry point — which pulls `msg/en` in for you — also
 * pulls in the stock CPython-shaped block set we deliberately don't want.
 *
 * An empty message table is not a cosmetic problem. Core reads `Msg` in places
 * that have nothing to do with wording: `inject` dies inside its own
 * `setInitialAriaContext` on `Msg.WORKSPACE_ARIA_LABEL.replace(…)`, and a
 * variable field dies on its rename menu the moment a workspace containing one
 * is DESERIALISED — which happens headlessly, in the generator, with no UI
 * anywhere near it.
 *
 * So this is a precondition of using Blockly at all, not of showing it, and it
 * lives beside the generator rather than inside the canvas component. Importing
 * this module installs the table; both the canvas (#1009) and the generator
 * (#1010) do, and so must anything else that touches a Blockly workspace.
 *
 * Module scope rather than an effect: it has to be true before the first
 * `inject` or `load`, and it is global to Blockly either way.
 */
Blockly.setLocale(BlocklyEn as unknown as Record<string, string>)

/**
 * A no-op the module's importers can call to make the dependency explicit.
 *
 * Without it a bundler — or a well-meaning editor's "remove unused import" —
 * can drop what looks like an unreferenced import and take the message table
 * with it, turning this into a crash a long way from here.
 */
export function ensureBlocklyLocale(): void {
  /* the import above is the work */
}
