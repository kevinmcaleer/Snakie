import * as Blockly from 'blockly/core'
import * as BlocklyEn from 'blockly/msg/en'
import { installBlockMessages } from './palette/messages'
import { DEFAULT_LANGUAGE, languageInfo } from '../../../../shared/languages'
import {
  loadBlockCatalogue,
  setActiveBlockCatalogue,
  type BlockCatalogue
} from './i18n'

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

/**
 * BLOCKLY'S OTHER LANGUAGES (multilingual blocks).
 * =============================================================================
 *
 * One chunk per pack, fetched the first time somebody picks that language —
 * sixty packs bundled into the canvas would be sixty packs every English
 * learner downloads for nothing. Written out rather than globbed because the
 * bundler can only split an `import()` whose path it can read.
 */
type MsgModule = Record<string, unknown>
const BLOCKLY_PACKS: Readonly<Record<string, () => Promise<MsgModule>>> = {
  'ab': () => import('blockly/msg/ab'),
  'af': () => import('blockly/msg/af'),
  'am': () => import('blockly/msg/am'),
  'ar': () => import('blockly/msg/ar'),
  'ast': () => import('blockly/msg/ast'),
  'az': () => import('blockly/msg/az'),
  'be': () => import('blockly/msg/be'),
  'bg': () => import('blockly/msg/bg'),
  'bn': () => import('blockly/msg/bn'),
  'ca': () => import('blockly/msg/ca'),
  'cs': () => import('blockly/msg/cs'),
  'da': () => import('blockly/msg/da'),
  'de': () => import('blockly/msg/de'),
  'el': () => import('blockly/msg/el'),
  'eo': () => import('blockly/msg/eo'),
  'es': () => import('blockly/msg/es'),
  'et': () => import('blockly/msg/et'),
  'eu': () => import('blockly/msg/eu'),
  'fa': () => import('blockly/msg/fa'),
  'fi': () => import('blockly/msg/fi'),
  'fr': () => import('blockly/msg/fr'),
  'ga': () => import('blockly/msg/ga'),
  'gl': () => import('blockly/msg/gl'),
  'ha': () => import('blockly/msg/ha'),
  'he': () => import('blockly/msg/he'),
  'hi': () => import('blockly/msg/hi'),
  'hr': () => import('blockly/msg/hr'),
  'hu': () => import('blockly/msg/hu'),
  'hy': () => import('blockly/msg/hy'),
  'id': () => import('blockly/msg/id'),
  'is': () => import('blockly/msg/is'),
  'it': () => import('blockly/msg/it'),
  'ja': () => import('blockly/msg/ja'),
  'ka': () => import('blockly/msg/ka'),
  'km': () => import('blockly/msg/km'),
  'ko': () => import('blockly/msg/ko'),
  'ku-latn': () => import('blockly/msg/ku-latn'),
  'lt': () => import('blockly/msg/lt'),
  'lv': () => import('blockly/msg/lv'),
  'nb': () => import('blockly/msg/nb'),
  'nl': () => import('blockly/msg/nl'),
  'oc': () => import('blockly/msg/oc'),
  'pl': () => import('blockly/msg/pl'),
  'pt': () => import('blockly/msg/pt'),
  'pt-br': () => import('blockly/msg/pt-br'),
  'ro': () => import('blockly/msg/ro'),
  'ru': () => import('blockly/msg/ru'),
  'sk': () => import('blockly/msg/sk'),
  'sl': () => import('blockly/msg/sl'),
  'sr': () => import('blockly/msg/sr'),
  'sv': () => import('blockly/msg/sv'),
  'sw': () => import('blockly/msg/sw'),
  'th': () => import('blockly/msg/th'),
  'tl': () => import('blockly/msg/tl'),
  'tr': () => import('blockly/msg/tr'),
  'uk': () => import('blockly/msg/uk'),
  'uz': () => import('blockly/msg/uz'),
  'vi': () => import('blockly/msg/vi'),
  'zh-hans': () => import('blockly/msg/zh-hans'),
  'zh-hant': () => import('blockly/msg/zh-hant'),
}

/** The language whose messages are installed right now. */
let installed = DEFAULT_LANGUAGE
/** Bumped by every {@link setBlocksLanguage}, so a superseded one stands down. */
let latestRequest = 0

/** Which language the block messages are in (a {@link LANGUAGES} code). */
export function blocksLanguage(): string {
  return installed
}

/** Copy a pack's strings into `Blockly.Msg` (its namespace carries a `default` too). */
function applyPack(pack: MsgModule): void {
  const strings: Record<string, string> = {}
  for (const [k, v] of Object.entries(pack)) if (typeof v === 'string') strings[k] = v
  Blockly.setLocale(strings)
}

/**
 * Switch the blocks to `code` (a {@link LANGUAGES} code; anything else is English).
 *
 * ENGLISH FIRST, EVERY TIME. `setLocale` merges rather than replaces, and packs
 * are not all equally complete — going from Deutsch to a pack that lacks a key
 * would otherwise leave that one string in German. Laying English down first
 * means a gap in any pack shows the English, which is what a gap should show.
 *
 * Messages are read when a block is BUILT, so a canvas already on screen keeps
 * its old words until it is rebuilt; the canvas re-injects on a language
 * change for exactly that reason. Resolves once everything is in place (or
 * once a later call has taken over), and never rejects: a pack that fails to
 * load leaves the English.
 */
export async function setBlocksLanguage(code: string): Promise<void> {
  // The LAST request wins. Packs load at different speeds, and a quick
  // Deutsch → Français → Deutsch must not end in whichever arrived last.
  const mine = ++latestRequest
  const info = languageInfo(code)
  const [pack, catalogue] = await Promise.all([
    info.blockly && info.blockly !== 'en'
      ? (BLOCKLY_PACKS[info.blockly]?.() ?? Promise.resolve(null)).catch((err: unknown) => {
          console.warn(`[blocks] could not load Blockly's ${info.blockly} messages`, err)
          return null
        })
      : Promise.resolve(null),
    loadBlockCatalogue(info.code)
  ])
  if (mine !== latestRequest) return
  applyPack(BlocklyEn as unknown as MsgModule)
  // Snakie's English rewordings of stock blocks sit on top of Blockly's
  // English, and only its English — a pack's own translation of "create text
  // with" was written by someone who speaks the language.
  installBlockMessages()
  if (pack) applyPack(pack)
  applyMsgOverrides(catalogue)
  setActiveBlockCatalogue(catalogue)
  installed = info.code
}

/** A catalogue's `Msg.<KEY>` entries: Snakie's own wording of a Blockly message. */
function applyMsgOverrides(catalogue: BlockCatalogue): void {
  for (const [key, value] of Object.entries(catalogue)) {
    if (key.startsWith('Msg.') && value.trim() !== '') Blockly.Msg[key.slice(4)] = value
  }
}

