import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import 'blockly/blocks'
import * as Blockly from 'blockly/core'
import {
  LANGUAGES,
  languageFromSearch,
  languageInfo,
  normaliseLanguage,
  resolveLanguage
} from '../src/shared/languages'
import { robotFromYaml, robotToYaml } from '../src/shared/robot-yaml'
import { registeredBlocks } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'
import {
  englishBlockStrings,
  localiseBlockJson,
  placeholders,
  setActiveBlockCatalogue
} from '../src/renderer/src/lib/blocks/i18n'
import { blocksLanguage, setBlocksLanguage } from '../src/renderer/src/lib/blocks/locale'
import { buildToolbox } from '../src/renderer/src/lib/blocks/toolbox'

/**
 * MULTILINGUAL BLOCKS.
 * =============================================================================
 *
 * The language is presentation: what the blocks SAY changes, what they
 * GENERATE never does. These pin the three halves of that — which language
 * wins, that a translation can't break a block, and that Blockly's messages
 * really do switch (and switch back).
 */

describe('the language list', () => {
  it("is Scratch's list, one entry per code", () => {
    const codes = LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain('en')
    expect(codes).toContain('pt-br')
    expect(codes).toContain('zh-cn')
    expect(LANGUAGES.length).toBe(80)
  })

  it("names only Blockly packs that exist, and locale.ts can load every one", () => {
    const locale = readFileSync(
      resolve(__dirname, '../src/renderer/src/lib/blocks/locale.ts'),
      'utf8'
    )
    for (const { code, blockly } of LANGUAGES) {
      if (!blockly) continue
      expect(existsSync(resolve(__dirname, `../node_modules/blockly/msg/${blockly}.js`)), code).toBe(
        true
      )
      if (blockly !== 'en') expect(locale, code).toContain(`import('blockly/msg/${blockly}')`)
    }
  })

  it('reads the spellings people actually type', () => {
    expect(normaliseLanguage('DE')).toBe('de')
    expect(normaliseLanguage('de-AT')).toBe('de')
    expect(normaliseLanguage('pt_BR')).toBe('pt-br')
    expect(normaliseLanguage('pt-PT')).toBe('pt')
    expect(normaliseLanguage('zh-Hans')).toBe('zh-cn')
    expect(normaliseLanguage('zh-TW')).toBe('zh-tw')
    expect(normaliseLanguage('es-MX')).toBe('es-419')
    expect(normaliseLanguage('es-ES')).toBe('es')
    expect(normaliseLanguage('ja-Hira')).toBe('ja-Hira')
    expect(normaliseLanguage('klingon')).toBeNull()
    expect(normaliseLanguage('')).toBeNull()
    expect(normaliseLanguage(undefined)).toBeNull()
  })

  it('falls back to English for anything unknown', () => {
    expect(languageInfo('xx').code).toBe('en')
    expect(languageInfo('ar').rtl).toBe(true)
  })
})

describe('which language wins', () => {
  it('?lang= beats the project, which beats the learner, which beats English', () => {
    expect(resolveLanguage({ url: 'fr', project: 'de', preference: 'es' })).toBe('fr')
    expect(resolveLanguage({ project: 'de', preference: 'es' })).toBe('de')
    expect(resolveLanguage({ preference: 'es' })).toBe('es')
    expect(resolveLanguage({})).toBe('en')
  })

  it('skips a voice that names nothing Snakie lists', () => {
    expect(resolveLanguage({ url: 'nope', project: 'de' })).toBe('de')
  })

  it("'system' follows the computer", () => {
    expect(resolveLanguage({ preference: 'system', system: 'fr-CA' })).toBe('fr')
    expect(resolveLanguage({ preference: 'system', system: null })).toBe('en')
  })

  it('reads ?lang= out of a query string', () => {
    expect(languageFromSearch('?lang=cy')).toBe('cy')
    expect(languageFromSearch('?x=1&lang=pt-BR')).toBe('pt-br')
    expect(languageFromSearch('')).toBeNull()
  })
})

describe('robot.yml language:', () => {
  it('round-trips, normalised', () => {
    const def = robotFromYaml('board: pico\nlanguage: pt_BR\nparts: []\nconnections: []\n')
    expect(def.language).toBe('pt-br')
    expect(robotToYaml(def)).toContain('language: pt-br')
  })

  it('drops a language Snakie does not list, and writes nothing when unset', () => {
    expect(robotFromYaml('language: klingon\n').language).toBeUndefined()
    expect(robotToYaml({ parts: [], connections: [] })).not.toContain('language')
  })
})

describe('translating a block definition', () => {
  const json = {
    message0: 'move %1 by %2',
    tooltip: 'Move it.',
    args0: [
      { type: 'input_value', name: 'A' },
      {
        type: 'field_dropdown',
        name: 'DIR',
        options: [
          ['left', 'LEFT'],
          ['right', 'RIGHT']
        ]
      }
    ]
  }

  it('swaps wording and dropdown LABELS, never the stored values', () => {
    const out = localiseBlockJson('t', json, {
      't.message0': 'bewege %2 um %1',
      't.tooltip': 'Bewege es.',
      't.DIR.LEFT': 'links'
    })
    expect(out.message0).toBe('bewege %2 um %1')
    expect(out.tooltip).toBe('Bewege es.')
    const dd = (out.args0 as Array<{ options?: string[][] }>)[1].options
    expect(dd).toEqual([
      ['links', 'LEFT'],
      ['right', 'RIGHT']
    ])
    // The registry's own definition is untouched.
    expect(json.args0[1]).toMatchObject({ options: [['left', 'LEFT'], ['right', 'RIGHT']] })
  })

  it("refuses a translation that loses or invents a placeholder", () => {
    const out = localiseBlockJson('t', json, { 't.message0': 'bewege %1' })
    expect(out.message0).toBe('move %1 by %2')
    expect(localiseBlockJson('t', json, { 't.message0': 'bewege %1 %2 %3' }).message0).toBe(
      'move %1 by %2'
    )
  })

  it('hands back the same object when there is nothing to do', () => {
    expect(localiseBlockJson('t', json, {})).toBe(json)
    expect(localiseBlockJson('t', json, { 'other.message0': 'x' })).toBe(json)
  })
})

describe("Snakie's catalogues", () => {
  beforeAll(() => installCorePalette())

  const known = (): Record<string, string> => {
    const out: Record<string, string> = {
      'ui.advanced': 'Advanced',
      'ui.advancedOff': ''
    }
    for (const c of BLOCK_CATEGORIES) out[`category.${c.id}`] = c.name
    for (const b of registeredBlocks()) if (b.group) out[`group.${b.group.id}`] = b.group.name
    return { ...out, ...englishBlockStrings(registeredBlocks()) }
  }

  for (const code of ['de', 'es', 'fr']) {
    it(`${code}: every key names a real string, with the same placeholders`, () => {
      const catalogue = JSON.parse(
        readFileSync(
          resolve(__dirname, `../src/renderer/src/lib/blocks/i18n/${code}.json`),
          'utf8'
        )
      ) as Record<string, string>
      const english = known()
      for (const [key, text] of Object.entries(catalogue)) {
        expect(key in english, `${code} ${key} is not a string any block has`).toBe(true)
        if (/\.message\d+$/.test(key)) {
          expect(placeholders(text), `${code} ${key}`).toBe(placeholders(english[key]))
        }
      }
    })
  }
})

describe('switching the blocks language', () => {
  afterAll(async () => {
    await setBlocksLanguage('en')
    setActiveBlockCatalogue({})
  })

  it("installs Blockly's pack and Snakie's catalogue, then puts English back", async () => {
    installCorePalette()
    expect(blocksLanguage()).toBe('en')
    expect(Blockly.Msg['CONTROLS_IF_MSG_IF']).toBe('if')

    await setBlocksLanguage('de')
    expect(blocksLanguage()).toBe('de')
    expect(Blockly.Msg['CONTROLS_IF_MSG_IF']).toBe('falls')
    const toolbox = buildToolbox('micropython', 'advanced') as { contents: Array<{ name?: string }> }
    expect(toolbox.contents.map((c) => c.name)).toContain('Steuerung')

    await setBlocksLanguage('en')
    expect(Blockly.Msg['CONTROLS_IF_MSG_IF']).toBe('if')
    // Snakie's English rewording of a stock block survives the round trip.
    expect(Blockly.Msg['TEXT_JOIN_TITLE_CREATEWITH']).toBe('join')
    const back = buildToolbox('micropython', 'advanced') as { contents: Array<{ name?: string }> }
    expect(back.contents.map((c) => c.name)).toContain('Control')
  })

  it('the last of two quick switches wins', async () => {
    const first = setBlocksLanguage('fr')
    const second = setBlocksLanguage('es')
    await Promise.all([first, second])
    expect(blocksLanguage()).toBe('es')
  })

  it('a language Blockly has no pack for still gets English stock blocks', async () => {
    await setBlocksLanguage('cy')
    expect(blocksLanguage()).toBe('cy')
    expect(Blockly.Msg['CONTROLS_IF_MSG_IF']).toBe('if')
  })
})
