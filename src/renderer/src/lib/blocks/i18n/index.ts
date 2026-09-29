/**
 * SNAKIE'S OWN BLOCK WORDING, TRANSLATED (multilingual blocks).
 * =============================================================================
 *
 * Blockly's packs (`blockly/msg/*`, loaded by `../locale.ts`) translate the
 * stock blocks — `if`, `repeat`, maths, text, lists — and the workspace menus.
 * They know nothing about the blocks Snakie defines itself: `forever`, the
 * hardware drawer, the turtle, the toolbox's category names. This is where
 * those come from.
 *
 * ONE FLAT CATALOGUE PER LANGUAGE, keyed by what the English is attached to,
 * so no palette file has to change for its blocks to become translatable:
 *
 *   `category.<id>`                    a toolbox category, e.g. `category.control`
 *   `group.<id>`                       a sub-drawer, e.g. `group.text-more`
 *   `<blockType>.message0` (…1, …2)    a line of a block's face
 *   `<blockType>.tooltip`              its tooltip
 *   `<blockType>.<FIELD>.<value>`      one option of a dropdown field
 *   `Msg.<KEY>`                        a Blockly message Snakie words its own way
 *   `ui.<key>`                         a few words of toolbox chrome
 *
 * A key that is missing falls back to the English — so a catalogue can be
 * partial, and grows one string at a time without ever showing a hole.
 *
 * THE PROGRAM IS NOT TRANSLATED. Only what a block SAYS; never what it
 * generates, never a field's VALUE (the option a dropdown stores in the file),
 * never a Python name. A program built in Deutsch is the same program, and
 * opens in English, byte for byte.
 */

export type BlockCatalogue = Readonly<Record<string, string>>

/**
 * The catalogues that exist, loaded on demand so a learner in English never
 * downloads anybody else's.
 */
const CATALOGUES: Readonly<Record<string, () => Promise<{ default: BlockCatalogue }>>> = {
  de: () => import('./de.json'),
  es: () => import('./es.json'),
  'es-419': () => import('./es.json'),
  fr: () => import('./fr.json')
}

/** The languages that have a catalogue of Snakie's own blocks, even a partial one. */
export function hasBlockCatalogue(code: string): boolean {
  return code in CATALOGUES
}

let active: BlockCatalogue = {}

/** Fetch a language's catalogue — `{}` for English or one that has none yet. */
export async function loadBlockCatalogue(code: string): Promise<BlockCatalogue> {
  const load = CATALOGUES[code]
  if (!load) return {}
  try {
    return (await load()).default
  } catch (err) {
    console.warn(`[blocks] could not load the ${code} block catalogue`, err)
    return {}
  }
}

/** Make `catalogue` the one {@link blockText} and {@link localiseBlockJson} read. */
export function setActiveBlockCatalogue(catalogue: BlockCatalogue): void {
  active = catalogue
}

/** The catalogue in force. */
export function activeBlockCatalogue(): BlockCatalogue {
  return active
}

/** A translated string, or the English it was keyed on. */
export function blockText(key: string, english: string, catalogue = active): string {
  const t = catalogue[key]
  return typeof t === 'string' && t.trim() !== '' ? t : english
}

/**
 * The `%1`, `%2` … placeholders a message carries, sorted.
 *
 * A translation may MOVE them — word order is the whole reason they are
 * numbered — but it may not lose or invent one. Blockly builds the block's
 * inputs from them, so a translated `move %1` with the `%1` missing is a block
 * with nowhere to plug its number in, and a stray `%3` throws while the block is
 * built. Either would take a canvas down over a typo in a translation file.
 */
export function placeholders(message: string): string {
  return (message.match(/%\d+/g) ?? []).sort().join(',')
}

const MESSAGE_KEY = /^message\d+$/
const ARGS_KEY = /^args\d+$/

/**
 * A block's JSON definition with its wording swapped for the catalogue's.
 *
 * Returns the SAME object when nothing changes, and a copy otherwise — the
 * registry's definition is never mutated, so switching back to English is just
 * installing the original again.
 */
export function localiseBlockJson(
  type: string,
  json: Record<string, unknown>,
  catalogue = active
): Record<string, unknown> {
  if (Object.keys(catalogue).length === 0) return json
  let out: Record<string, unknown> | null = null
  const put = (key: string, value: unknown): void => {
    out ??= { ...json }
    out[key] = value
  }

  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'string' && (MESSAGE_KEY.test(key) || key === 'tooltip')) {
      const t = catalogue[`${type}.${key}`]
      if (typeof t !== 'string' || t.trim() === '' || t === value) continue
      if (key !== 'tooltip' && placeholders(t) !== placeholders(value)) {
        console.warn(`[blocks] ignoring ${type}.${key}: its placeholders don't match the English`)
        continue
      }
      put(key, t)
    } else if (ARGS_KEY.test(key) && Array.isArray(value)) {
      const args = localiseDropdowns(type, value, catalogue)
      if (args !== value) put(key, args)
    }
  }
  return out ?? json
}

/** The dropdown options inside one `argsN` list, translated where the catalogue says. */
function localiseDropdowns(type: string, args: unknown[], catalogue: BlockCatalogue): unknown[] {
  let changed = false
  const next = args.map((arg) => {
    if (!arg || typeof arg !== 'object') return arg
    const a = arg as { type?: unknown; name?: unknown; options?: unknown }
    if (a.type !== 'field_dropdown' || typeof a.name !== 'string' || !Array.isArray(a.options)) {
      return arg
    }
    let optionsChanged = false
    const options = a.options.map((opt) => {
      // A label that is an image (an object) has no words to translate.
      if (!Array.isArray(opt) || typeof opt[0] !== 'string' || typeof opt[1] !== 'string') {
        return opt
      }
      const t = catalogue[`${type}.${a.name}.${opt[1]}`]
      if (typeof t !== 'string' || t.trim() === '' || t === opt[0]) return opt
      optionsChanged = true
      return [t, opt[1]]
    })
    if (!optionsChanged) return arg
    changed = true
    return { ...a, options }
  })
  return changed ? next : args
}

/**
 * Every English string a catalogue can translate for these definitions,
 * keyed the way a catalogue keys them.
 *
 * For whoever writes the next catalogue (and for the tests that check the
 * existing ones only name keys that exist): this is the list to translate.
 */
export function englishBlockStrings(
  defs: ReadonlyArray<{ type: string; json?: Record<string, unknown> }>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { type, json } of defs) {
    if (!json) continue
    for (const [key, value] of Object.entries(json)) {
      if (typeof value === 'string' && (MESSAGE_KEY.test(key) || key === 'tooltip')) {
        // `%1` alone is a layout line (a statement input on a row of its own),
        // not wording.
        if (value.replace(/%\d+/g, '').trim() !== '') out[`${type}.${key}`] = value
      } else if (ARGS_KEY.test(key) && Array.isArray(value)) {
        for (const arg of value) {
          const a = arg as { type?: unknown; name?: unknown; options?: unknown }
          if (a?.type !== 'field_dropdown' || typeof a.name !== 'string') continue
          if (!Array.isArray(a.options)) continue
          for (const opt of a.options) {
            if (Array.isArray(opt) && typeof opt[0] === 'string' && typeof opt[1] === 'string') {
              out[`${type}.${a.name}.${opt[1]}`] = opt[0]
            }
          }
        }
      }
    }
  }
  return out
}
