/**
 * THE LANGUAGES SNAKIE CAN SHOW ITS BLOCKS IN (multilingual blocks).
 * =============================================================================
 *
 * The list is Scratch's (`scratch-l10n`'s `supported-locales`), code for code
 * and name for name, so a class that already runs Scratch in Cymraeg or
 * Português Brasileiro finds the same entry here under the same label. Each
 * name is written in its own language, because the person looking for it may
 * not read English.
 *
 * WHAT A LANGUAGE CHANGES: the PRESENTATION of the blocks — the words on them,
 * the toolbox categories, Blockly's menus. It never changes the program. The
 * Python a block generates, the names of MicroPython's modules and functions,
 * and everything that goes to or comes from the board stay exactly as they are,
 * because they are the language the learner is on their way to writing.
 *
 * `blockly` is which of Blockly's own translation packs (`blockly/msg/*`)
 * covers the stock blocks (`if`, `repeat`, maths, text, lists…) and the
 * workspace menus. Where Blockly has no pack for a language this falls back the
 * way Scratch itself does (Aragonés → Español, Kreyòl → Français) or, with no
 * sensible neighbour, to English — `null` — so the choice is still honoured for
 * everything Snakie itself translates.
 */

export interface LanguageInfo {
  /** Scratch's locale code, e.g. `pt-br`. Also what `?lang=` and robot.yml take. */
  code: string
  /** The language's name in that language. */
  name: string
  /** Blockly's pack for it, or `null` when Blockly has none (English fallback). */
  blockly: string | null
  /** Written right to left — the block canvas mirrors for these. */
  rtl?: boolean
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'ab', name: 'Аҧсшәа', blockly: 'ab' },
  { code: 'af', name: 'Afrikaans', blockly: 'af' },
  { code: 'ar', name: 'العربية', blockly: 'ar', rtl: true },
  { code: 'am', name: 'አማርኛ', blockly: 'am' },
  { code: 'an', name: 'Aragonés', blockly: 'es' },
  { code: 'ast', name: 'Asturianu', blockly: 'ast' },
  { code: 'az', name: 'Azeri', blockly: 'az' },
  { code: 'id', name: 'Bahasa Indonesia', blockly: 'id' },
  { code: 'bn', name: 'বাংলা', blockly: 'bn' },
  { code: 'be', name: 'Беларуская', blockly: 'be' },
  { code: 'bg', name: 'Български', blockly: 'bg' },
  { code: 'ca', name: 'Català', blockly: 'ca' },
  { code: 'cs', name: 'Česky', blockly: 'cs' },
  { code: 'cy', name: 'Cymraeg', blockly: null },
  { code: 'da', name: 'Dansk', blockly: 'da' },
  { code: 'de', name: 'Deutsch', blockly: 'de' },
  { code: 'et', name: 'Eesti', blockly: 'et' },
  { code: 'el', name: 'Ελληνικά', blockly: 'el' },
  { code: 'en', name: 'English', blockly: 'en' },
  { code: 'es', name: 'Español (España)', blockly: 'es' },
  { code: 'es-419', name: 'Español Latinoamericano', blockly: 'es' },
  { code: 'eo', name: 'Esperanto', blockly: 'eo' },
  { code: 'eu', name: 'Euskara', blockly: 'eu' },
  { code: 'fa', name: 'فارسی', blockly: 'fa', rtl: true },
  { code: 'fil', name: 'Filipino', blockly: 'tl' },
  { code: 'fr', name: 'Français', blockly: 'fr' },
  { code: 'fy', name: 'Frysk', blockly: null },
  { code: 'ga', name: 'Gaeilge', blockly: 'ga' },
  { code: 'gd', name: 'Gàidhlig', blockly: null },
  { code: 'gl', name: 'Galego', blockly: 'gl' },
  { code: 'ko', name: '한국어', blockly: 'ko' },
  { code: 'ha', name: 'Hausa', blockly: 'ha' },
  { code: 'hy', name: 'Հայերեն', blockly: 'hy' },
  { code: 'he', name: 'עִבְרִית', blockly: 'he', rtl: true },
  { code: 'hi', name: 'हिंदी', blockly: 'hi' },
  { code: 'hr', name: 'Hrvatski', blockly: 'hr' },
  { code: 'xh', name: 'isiXhosa', blockly: null },
  { code: 'zu', name: 'isiZulu', blockly: null },
  { code: 'is', name: 'Íslenska', blockly: 'is' },
  { code: 'it', name: 'Italiano', blockly: 'it' },
  { code: 'ka', name: 'ქართული ენა', blockly: 'ka' },
  { code: 'kk', name: 'қазақша', blockly: null },
  { code: 'qu', name: 'Kichwa', blockly: null },
  { code: 'sw', name: 'Kiswahili', blockly: 'sw' },
  { code: 'ht', name: 'Kreyòl ayisyen', blockly: 'fr' },
  { code: 'ku', name: 'Kurdî', blockly: 'ku-latn' },
  { code: 'ckb', name: 'کوردیی ناوەندی', blockly: null, rtl: true },
  { code: 'lv', name: 'Latviešu', blockly: 'lv' },
  { code: 'lt', name: 'Lietuvių', blockly: 'lt' },
  { code: 'hu', name: 'Magyar', blockly: 'hu' },
  { code: 'mi', name: 'Māori', blockly: null },
  { code: 'mn', name: 'Монгол хэл', blockly: null },
  { code: 'nl', name: 'Nederlands', blockly: 'nl' },
  { code: 'ja', name: '日本語', blockly: 'ja' },
  { code: 'ja-Hira', name: 'にほんご', blockly: 'ja' },
  { code: 'nb', name: 'Norsk Bokmål', blockly: 'nb' },
  { code: 'nn', name: 'Norsk Nynorsk', blockly: 'nb' },
  { code: 'oc', name: 'Occitan', blockly: 'oc' },
  { code: 'or', name: 'ଓଡ଼ିଆ', blockly: null },
  { code: 'uz', name: 'Oʻzbekcha', blockly: 'uz' },
  { code: 'th', name: 'ไทย', blockly: 'th' },
  { code: 'km', name: 'ភាសាខ្មែរ', blockly: 'km' },
  { code: 'pl', name: 'Polski', blockly: 'pl' },
  { code: 'pt', name: 'Português', blockly: 'pt' },
  { code: 'pt-br', name: 'Português Brasileiro', blockly: 'pt-br' },
  { code: 'rap', name: 'Rapa Nui', blockly: 'es' },
  { code: 'ro', name: 'Română', blockly: 'ro' },
  { code: 'ru', name: 'Русский', blockly: 'ru' },
  { code: 'nso', name: 'Sepedi', blockly: null },
  { code: 'tn', name: 'Setswana', blockly: null },
  { code: 'sk', name: 'Slovenčina', blockly: 'sk' },
  { code: 'sl', name: 'Slovenščina', blockly: 'sl' },
  { code: 'sr', name: 'Српски', blockly: 'sr' },
  { code: 'fi', name: 'Suomi', blockly: 'fi' },
  { code: 'sv', name: 'Svenska', blockly: 'sv' },
  { code: 'vi', name: 'Tiếng Việt', blockly: 'vi' },
  { code: 'tr', name: 'Türkçe', blockly: 'tr' },
  { code: 'uk', name: 'Українська', blockly: 'uk' },
  { code: 'zh-cn', name: '简体中文', blockly: 'zh-hans' },
  { code: 'zh-tw', name: '繁體中文', blockly: 'zh-hant' }
]

/** English — the language every string is written in first, and the fallback. */
export const DEFAULT_LANGUAGE = 'en'

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]))

/**
 * Spellings other tools use for the same language, mapped onto Scratch's code.
 * BCP 47 script subtags (`zh-Hans`), region subtags a browser reports
 * (`zh-TW`, `es-MX`), and the codes Blockly's packs are named by.
 */
const ALIASES: Readonly<Record<string, string>> = {
  'zh-hans': 'zh-cn',
  'zh-sg': 'zh-cn',
  'zh-hant': 'zh-tw',
  'zh-hk': 'zh-tw',
  'zh-mo': 'zh-tw',
  zh: 'zh-cn',
  tl: 'fil',
  iw: 'he',
  in: 'id',
  no: 'nb',
  'ku-latn': 'ku'
}

/**
 * One of {@link LANGUAGES}' codes for whatever a URL, a robot.yml or a browser
 * says, or `null` for a language Snakie doesn't list.
 *
 * Forgiving on purpose — these come from people typing `?lang=DE` or
 * `language: pt_BR` into a file — and the forgiving goes region-first: `pt-BR`
 * is Brazilian Portuguese (its own entry), while `de-AT` is just Deutsch.
 */
export function normaliseLanguage(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const tag = raw.trim().replace(/_/g, '-').toLowerCase()
  if (!tag) return null
  const exact = BY_CODE.get(ALIASES[tag] ?? tag)
  if (exact) return exact.code
  // Latin-American Spanish is one entry for every country that speaks it.
  if (/^es-(?!es\b)[a-z0-9]+$/.test(tag)) return 'es-419'
  const [primary] = tag.split('-')
  const base = BY_CODE.get(ALIASES[primary] ?? primary)
  return base ? base.code : null
}

/** The entry for a (normalised) code, falling back to English. */
export function languageInfo(code: string | null | undefined): LanguageInfo {
  const found = normaliseLanguage(code)
  return BY_CODE.get((found ?? DEFAULT_LANGUAGE).toLowerCase()) ?? LANGUAGES[0]
}

/** The personal setting: English, the computer's language, or a fixed choice. */
export type LanguagePreference = 'system' | string

/**
 * Which language the blocks are shown in, from everything that has a say.
 *
 * In order, the first that names a language Snakie lists wins:
 *
 *  1. `url` — `?lang=de` on the web app's address. A link a teacher hands out
 *     ("open this in Deutsch") works for everyone who clicks it, and is
 *     deliberately NOT written back to anyone's settings.
 *  2. `project` — `language:` in the project's robot.yml. The class's language
 *     travels with the project, so a starter handed out in Cymraeg opens in
 *     Cymraeg on every machine in the room.
 *  3. `preference` — Settings ▸ Appearance ▸ Language. `system` follows the
 *     computer's own language (`navigator.language`, passed as `system`).
 *  4. English.
 */
export function resolveLanguage(sources: {
  url?: string | null
  project?: string | null
  preference?: LanguagePreference | null
  system?: string | null
}): string {
  const pref =
    sources.preference === 'system' ? sources.system : (sources.preference ?? undefined)
  return (
    normaliseLanguage(sources.url) ??
    normaliseLanguage(sources.project) ??
    normaliseLanguage(pref) ??
    DEFAULT_LANGUAGE
  )
}

/** The `lang` query parameter of a URL's search string (`?lang=de`), if any. */
export function languageFromSearch(search: string): string | null {
  try {
    return normaliseLanguage(new URLSearchParams(search).get('lang'))
  } catch {
    return null
  }
}
