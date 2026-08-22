import { describe, expect, it } from 'vitest'
import {
  couldNameSprite,
  pythonLexState,
  spriteCompletionContext,
  spriteCompletions
} from '../src/renderer/src/components/sprite-completions'
import { resolveSpriteRef } from '../src/renderer/src/components/sprite-refs'

/**
 * Split a source at the `|` marker: everything before it is what the editor
 * hands the scanner, the rest of that line is the tail. Keeps every case below
 * readable as the code the user is actually looking at.
 */
function at(source: string): { prefix: string; lineTail: string } {
  const cut = source.indexOf('|')
  expect(cut, 'the case must mark the cursor with |').toBeGreaterThanOrEqual(0)
  const prefix = source.slice(0, cut)
  const rest = source.slice(cut + 1)
  const eol = rest.indexOf('\n')
  return { prefix, lineTail: eol < 0 ? rest : rest.slice(0, eol) }
}

const contextAt = (source: string): ReturnType<typeof spriteCompletionContext> => {
  const { prefix, lineTail } = at(source)
  return spriteCompletionContext(prefix, lineTail)
}

describe('where the cursor is', () => {
  it('knows it is inside an unfinished literal, and where the body starts', () => {
    const state = pythonLexState('frames = Spr("ey')
    expect(state).toEqual({ kind: 'string', quote: '"', triple: false, raw: false, bodyStart: 14 })
  })

  it('knows a closed literal is behind it', () => {
    expect(pythonLexState('frames = Spr("eyes.spr")').kind).toBe('code')
    expect(pythonLexState('a = "one" + "two" + ').kind).toBe('code')
  })

  it('does not mistake an apostrophe in a comment for a quote', () => {
    // The failure a line regex makes: `don't` opens a literal that never closes,
    // and every following line looks like string.
    expect(pythonLexState("# don't do this\na = ").kind).toBe('code')
    expect(pythonLexState("# don't do this\na = \"ey").kind).toBe('string')
  })

  it('reports a comment as a comment, however it started', () => {
    expect(pythonLexState('a = 1  # eyes.').kind).toBe('comment')
    expect(pythonLexState('x = "ok"  # ').kind).toBe('comment')
  })

  it('tracks a docstring across the lines it spans', () => {
    const state = pythonLexState('"""\nuses eyes.spr\nand more')
    expect(state).toMatchObject({ kind: 'string', triple: true })
  })

  it('is not fooled by an escaped quote, unless the literal is raw', () => {
    expect(pythonLexState('a = "he said \\" and ').kind).toBe('string')
    // In a raw literal the backslash is a character, so the quote really closes.
    expect(pythonLexState('a = r"he said \\" and ').kind).toBe('code')
  })

  it('treats a prefix as part of its literal, but only a real one', () => {
    expect(pythonLexState('a = rb"ey')).toMatchObject({ raw: true })
    expect(pythonLexState('a = f"ey')).toMatchObject({ raw: false, triple: false })
    // `spr` is not a string prefix — the quote still opens a plain literal.
    expect(pythonLexState('a = spr"ey')).toMatchObject({ kind: 'string', raw: false })
  })

  it('ends a single-quoted literal at the line break Python would reject it on', () => {
    expect(pythonLexState('a = "oops\nb = 1').kind).toBe('code')
  })
})

describe('when a sprite name is offered', () => {
  it('offers inside a string literal, empty or part-typed', () => {
    expect(contextAt('frames = Spr("|")')).toMatchObject({ body: '', closed: true })
    expect(contextAt('frames = Spr("ey|")')).toMatchObject({ body: 'ey', closed: true })
    expect(contextAt("SPR = 'sprites/ey|'")).toMatchObject({ body: 'sprites/ey', quote: "'" })
  })

  it('offers to replace the WHOLE name when the cursor lands mid-word', () => {
    // `"ey|es.spr"` — accepting must not leave `es.spr` stranded behind it.
    const context = contextAt('frames = Spr("ey|es.spr")')
    expect(context).toMatchObject({ body: 'ey', tailLength: 6, closed: true })
  })

  it('closes a literal the editor left open', () => {
    expect(contextAt('frames = Spr("ey|')).toMatchObject({ closed: false, quote: '"' })
    expect(contextAt('frames = Spr("ey|")')).toMatchObject({ closed: true })
  })

  it('offers NOTHING in code, in a comment or in a docstring', () => {
    expect(contextAt('frames = Spr(ey|)')).toBeNull()
    expect(contextAt('x = 1  # eyes.spr is the| one')).toBeNull()
    expect(contextAt('"""\nLoads eyes.s|pr at boot.\n"""')).toBeNull()
    // A comment that contains an apostrophe used to swallow the rest of the file.
    expect(contextAt("# it's the eyes\nx = 1|")).toBeNull()
  })

  it('offers NOTHING inside a template or a pattern it could never fix', () => {
    for (const source of [
      'p = f"{stem|}.spr"', // an f-string placeholder
      'p = f"frames/{i}|.spr"',
      'p = "%s|.spr" % stem', // a printf template
      'p = "frames/*|.spr"', // a glob
      'p = " |eyes.spr"' // padded — the name would never resolve
    ]) {
      expect(contextAt(source), source).toBeNull()
    }
  })

  it('offers nothing when the cursor is on the wrong side of the quotes', () => {
    expect(contextAt('frames = Spr(|"eyes.spr")')).toBeNull()
    expect(contextAt('frames = Spr("eyes.spr"|)')).toBeNull()
  })

  it('is never a sprite place when the line holds no quote before the cursor', () => {
    // The property the editor's fast path leans on: a single-quoted literal
    // cannot cross a line break, so a line with no quote before the cursor can
    // skip reading the buffer entirely. If that ever stops holding, this fails.
    for (const source of [
      'frames = Spr(ey|)',
      'x = 1  # eyes.spr|',
      '"""\nLoads eyes.spr|\n"""',
      'a = "one"\nb = ey|'
    ]) {
      const { prefix } = at(source)
      const head = prefix.slice(prefix.lastIndexOf('\n') + 1)
      expect(head.includes('"') || head.includes("'"), source).toBe(false)
      expect(contextAt(source), source).toBeNull()
    }
  })

  it('still offers inside an ordinary string — that is the discovery', () => {
    // Any string could be a sprite name; the extension in every label is what
    // keeps `print("hello")` quiet, because nothing there matches the filter.
    expect(contextAt('print("hel|lo")')).not.toBeNull()
  })
})

describe('what could still become a sprite name', () => {
  it('accepts a partial name and refuses a template', () => {
    expect(couldNameSprite('')).toBe(true)
    expect(couldNameSprite('ey')).toBe(true)
    expect(couldNameSprite('sprites/')).toBe(true)
    expect(couldNameSprite('../shared/ey')).toBe(true)
    expect(couldNameSprite('eyes.spr')).toBe(true) // re-completing over a typo
    expect(couldNameSprite('{stem}')).toBe(false)
    expect(couldNameSprite('%s')).toBe(false)
    expect(couldNameSprite('*')).toBe(false)
    expect(couldNameSprite(' eyes')).toBe(false)
  })
})

// ── Ranking ─────────────────────────────────────────────────────────────────

const scope = { fileDir: '/proj/src', projectRoot: '/proj' }

describe('which sprite is offered, and as what name', () => {
  it('names a sprite in the file’s own folder by its bare name, first', () => {
    const items = spriteCompletions({
      paths: ['/proj/art/logo.spr', '/proj/src/eyes.spr'],
      scope
    })
    expect(items.map((i) => i.text)).toEqual(['eyes.spr', 'art/logo.spr'])
    expect(items[0].proximity).toBeLessThan(items[1].proximity)
  })

  it('sorts nearer before further, then shallower before deeper', () => {
    const items = spriteCompletions({
      paths: [
        '/proj/a/b/c/deep.spr',
        '/proj/top.spr',
        '/proj/src/near.spr',
        '/proj/src/sub/nearer-but-deeper.spr'
      ],
      scope
    })
    expect([...items].sort((a, b) => a.sortText.localeCompare(b.sortText)).map((i) => i.text))
      .toEqual(['near.spr', 'sub/nearer-but-deeper.spr', 'top.spr', 'a/b/c/deep.spr'])
  })

  it('EVERY offered name resolves back to the file it stands for', () => {
    // The property that matters: a completion that resolves somewhere else is
    // worse than no completion, because the failure lands on the board.
    const paths = [
      '/proj/eyes.spr',
      '/proj/src/eyes.spr', // the same name, nearer — shadows the one above
      '/proj/src/mouth.spr',
      '/proj/art/logo.spr'
    ]
    const items = spriteCompletions({ paths, scope })
    expect(items).toHaveLength(paths.length)
    for (const item of items) {
      const landed = resolveSpriteRef(item.text, scope).find((c) => paths.includes(c))
      expect(landed, `${item.text} -> ${item.path}`).toBe(item.path)
    }
  })

  it('names a shadowed sprite outright rather than pointing at its rival', () => {
    const items = spriteCompletions({
      paths: ['/proj/eyes.spr', '/proj/src/eyes.spr'],
      scope
    })
    expect(items.map((i) => i.text).sort()).toEqual(['/proj/eyes.spr', 'eyes.spr'])
  })

  it('offers nothing at all when the project has no sprites', () => {
    expect(spriteCompletions({ paths: [], scope })).toEqual([])
  })

  it('carries the size and frame count when the sprite has been read', () => {
    const summaries: Record<string, string> = { '/proj/src/eyes.spr': '12×8 · 3 frames' }
    const items = spriteCompletions({
      paths: ['/proj/src/eyes.spr', '/proj/src/unread.spr'],
      scope,
      describe: (path) => summaries[path]
    })
    expect(items.find((i) => i.text === 'eyes.spr')?.detail).toBe('12×8 · 3 frames')
    // Not yet measured: still offered, just without the line — a name the user
    // can see beats withholding it until the file has been decoded.
    expect(items.find((i) => i.text === 'unread.spr')?.detail).toBeUndefined()
  })

  it('drops a file no literal could ever name', () => {
    const items = spriteCompletions({ paths: ['/proj/src/{gen}.spr'], scope })
    expect(items).toEqual([])
  })

  it('never offers the same file twice, whatever the folders overlap', () => {
    const items = spriteCompletions({
      paths: ['/proj/src/eyes.spr', '/proj/src//eyes.spr'],
      scope
    })
    expect(items).toHaveLength(1)
  })

  it('falls back to an absolute name for a sprite outside both folders', () => {
    const items = spriteCompletions({ paths: ['/elsewhere/eyes.spr'], scope })
    expect(items[0].text).toBe('/elsewhere/eyes.spr')
    expect(resolveSpriteRef(items[0].text, scope)).toEqual(['/elsewhere/eyes.spr'])
  })

  it('with no folders to resolve against, a sprite can only be named outright', () => {
    expect(
      spriteCompletions({ paths: ['/proj/eyes.spr'], scope: { fileDir: null, projectRoot: null } })
        .map((i) => i.text)
    ).toEqual(['/proj/eyes.spr'])
  })
})
