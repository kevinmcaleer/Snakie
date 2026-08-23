import { describe, expect, it } from 'vitest'
import {
  SPRITE_EXT,
  chooseSpriteCandidate,
  dirname,
  findSpriteRefs,
  isAbsolutePath,
  isSpriteRefText,
  joinPath,
  normalisePath,
  pythonLexState,
  resolveSpriteRef,
  spriteSearchDirs
} from '../src/renderer/src/components/sprite-refs'

/** The literal texts a source names, in order — the shape most tests care about. */
const texts = (source: string): string[] => findSpriteRefs(source).map((r) => r.text)

describe('what counts as a sprite reference', () => {
  it('accepts a name that resolves to exactly one .spr file', () => {
    expect(isSpriteRefText('eyes.spr')).toBe(true)
    expect(isSpriteRefText('sprites/eyes.spr')).toBe(true)
    expect(isSpriteRefText('../shared/eyes.spr')).toBe(true)
    expect(isSpriteRefText('/home/kev/eyes.spr')).toBe(true)
    expect(isSpriteRefText('EYES.SPR')).toBe(true) // extension match is case-blind
  })

  it('does nothing rather than guess at a template, a pattern or a fragment', () => {
    // Each of these COULD name a sprite at runtime. Guessing which one would put
    // a thumbnail beside the wrong file, which is worse than none.
    for (const text of [
      '{stem}.spr', // f-string placeholder
      'frames/{0}.spr',
      '%s.spr', // printf template
      'frames/*.spr', // glob
      'eyes.?spr',
      '.spr', // bare extension, no stem
      'sprites/.spr',
      ' eyes.spr', // padded — almost certainly a slip
      'eyes.spr ',
      'eyes.sprite', // a longer extension is not .spr
      'eyes.spr.bak',
      'eyes',
      ''
    ]) {
      expect(isSpriteRefText(text), text).toBe(false)
    }
  })

  it('rejects anything with a control character in it', () => {
    expect(isSpriteRefText('eyes\n.spr')).toBe(false)
    expect(isSpriteRefText('eyes\t.spr')).toBe(false)
  })

  it('agrees with the scanner — a text the rule rejects is never reported', () => {
    const source = [
      'a = "eyes.spr"',
      'b = f"{stem}.spr"',
      'c = "%s.spr" % stem',
      'd = "frames/*.spr"',
      'e = ".spr"'
    ].join('\n')
    for (const ref of findSpriteRefs(source)) expect(isSpriteRefText(ref.text)).toBe(true)
    expect(texts(source)).toEqual(['eyes.spr'])
  })
})

describe('finding references in Python source', () => {
  it('reports the literal with a range that covers the quotes', () => {
    const refs = findSpriteRefs('frames = Spr("eyes.spr")\n')
    expect(refs).toHaveLength(1)
    const [ref] = refs
    expect(ref.text).toBe('eyes.spr')
    expect(ref.line).toBe(1)
    // 1-based columns: the opening quote, and one past the closing quote.
    expect('frames = Spr('.length + 1).toBe(ref.startColumn)
    expect('frames = Spr("eyes.spr")'.length).toBe(ref.endColumn)
  })

  it('keys off the LITERAL, not a function name — an assignment counts', () => {
    // examples/sprites/play_spr.py writes exactly this. A rule that looked for a
    // loader call would miss the bundled example outright.
    expect(texts('SPR_FILE = "blinking_eyes.spr"')).toEqual(['blinking_eyes.spr'])
  })

  it('finds every reference on a line, in order', () => {
    expect(texts("EYES = ['open.spr', 'shut.spr']")).toEqual(['open.spr', 'shut.spr'])
    const cols = findSpriteRefs("EYES = ['open.spr', 'shut.spr']").map((r) => r.startColumn)
    expect(cols[0]).toBeLessThan(cols[1])
  })

  it('tracks line numbers across a file', () => {
    const refs = findSpriteRefs('import x\n\nA = "a.spr"\nB = "b.spr"\n')
    expect(refs.map((r) => [r.text, r.line])).toEqual([
      ['a.spr', 3],
      ['b.spr', 4]
    ])
  })

  it('handles CRLF without shifting the columns', () => {
    const lf = findSpriteRefs('x = 1\nA = "a.spr"\n')
    const crlf = findSpriteRefs('x = 1\r\nA = "a.spr"\r\n')
    expect(crlf).toEqual(lf)
  })

  it('ignores comments, including commented-out code', () => {
    expect(texts('# eyes.spr lives here')).toEqual([])
    expect(texts('# frames = Spr("eyes.spr")')).toEqual([])
    expect(texts('x = 1  # "eyes.spr" is the old one')).toEqual([])
  })

  it("doesn't mistake a # inside a string for a comment", () => {
    // The naive regex-and-strip-comments approach loses the second reference.
    expect(texts('a = "#1.spr"\nb = "b.spr"')).toEqual(['#1.spr', 'b.spr'])
  })

  it('ignores docstrings — mentioning a sprite is not using one', () => {
    expect(texts('"""Plays eyes.spr on the matrix."""\n')).toEqual([])
    expect(texts('"""\nSee "eyes.spr".\n"""\nA = "real.spr"')).toEqual(['real.spr'])
  })

  it("doesn't let an apostrophe in a comment pair with a later quote", () => {
    expect(texts("# it's fine\nA = 'a.spr'")).toEqual(['a.spr'])
  })

  it('understands string prefixes', () => {
    expect(texts('A = r"eyes.spr"')).toEqual(['eyes.spr'])
    expect(texts('A = b"eyes.spr"')).toEqual(['eyes.spr'])
    expect(texts('A = f"eyes.spr"')).toEqual(['eyes.spr']) // no placeholder = a literal
    expect(texts('A = f"{stem}.spr"')).toEqual([]) // a placeholder = unknowable
  })

  it('resolves the escapes a path can legitimately contain, and drops the rest', () => {
    expect(texts('A = "sprites\\\\eyes.spr"')).toEqual(['sprites\\eyes.spr'])
    expect(texts('A = r"sprites\\eyes.spr"')).toEqual(['sprites\\eyes.spr'])
    // \n is not something a file name contains — decline rather than half-decode.
    expect(texts('A = "eyes\\n.spr"')).toEqual([])
  })

  it('recovers from an unterminated literal instead of eating the file', () => {
    expect(texts('A = "oops\nB = "b.spr"')).toEqual(['b.spr'])
  })

  it('reports nothing for an empty or reference-free source', () => {
    expect(findSpriteRefs('')).toEqual([])
    expect(findSpriteRefs('print("hello")\n')).toEqual([])
  })

  it('stays linear on a large file', () => {
    const source = 'x = "eyes.spr"\n'.repeat(5000)
    const started = Date.now()
    expect(findSpriteRefs(source)).toHaveLength(5000)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('path normalisation', () => {
  it('collapses . and .. lexically, keeping the input separator', () => {
    expect(normalisePath('/a/b/../c/./d.spr')).toBe('/a/c/d.spr')
    expect(normalisePath('C:\\a\\b\\..\\c.spr')).toBe('C:\\a\\c.spr')
    expect(normalisePath('/a//b')).toBe('/a/b')
    expect(normalisePath('/..')).toBe('/') // can't climb above the root
  })

  it('knows an absolute path from a relative one on both platforms', () => {
    expect(isAbsolutePath('/home/kev/a.spr')).toBe(true)
    expect(isAbsolutePath('C:\\proj\\a.spr')).toBe(true)
    expect(isAbsolutePath('C:/proj/a.spr')).toBe(true)
    expect(isAbsolutePath('\\\\nas\\share\\a.spr')).toBe(true)
    expect(isAbsolutePath('a.spr')).toBe(false)
    expect(isAbsolutePath('./a.spr')).toBe(false)
    expect(isAbsolutePath('../a.spr')).toBe(false)
  })

  it('joins onto the directory’s own separator', () => {
    expect(joinPath('/home/kev/proj', 'sprites/a.spr')).toBe('/home/kev/proj/sprites/a.spr')
    expect(joinPath('/home/kev/proj/', './a.spr')).toBe('/home/kev/proj/a.spr')
    expect(joinPath('/home/kev/proj/code', '../art/a.spr')).toBe('/home/kev/proj/art/a.spr')
    expect(joinPath('C:\\proj', 'sprites/a.spr')).toBe('C:\\proj\\sprites\\a.spr')
  })
})

describe('resolving a reference to candidate files', () => {
  const scope = { fileDir: '/proj/code', projectRoot: '/proj' }

  it('looks beside the file first, then in the project root', () => {
    expect(resolveSpriteRef('eyes.spr', scope)).toEqual(['/proj/code/eyes.spr', '/proj/eyes.spr'])
  })

  it('collapses the two when the file IS in the project root', () => {
    expect(resolveSpriteRef('eyes.spr', { fileDir: '/proj', projectRoot: '/proj' })).toEqual([
      '/proj/eyes.spr'
    ])
    expect(spriteSearchDirs({ fileDir: '/proj/', projectRoot: '/proj' })).toEqual(['/proj'])
  })

  it('takes an absolute reference at its word and looks nowhere else', () => {
    expect(resolveSpriteRef('/art/eyes.spr', scope)).toEqual(['/art/eyes.spr'])
  })

  it('returns nothing when there is nowhere to resolve against', () => {
    // An unsaved buffer with no project folder open: unknown, not broken — the
    // caller must draw NOTHING rather than a broken marker.
    expect(resolveSpriteRef('eyes.spr', {})).toEqual([])
    expect(resolveSpriteRef('eyes.spr', { fileDir: null, projectRoot: null })).toEqual([])
  })

  it('returns nothing for a text the rule does not accept', () => {
    expect(resolveSpriteRef('{stem}.spr', scope)).toEqual([])
    expect(resolveSpriteRef('eyes.png', scope)).toEqual([])
  })

  it('exports the extension the rest of the epic keys off', () => {
    expect(SPRITE_EXT).toBe('.spr')
  })
})

// ── The rules #797 folded back in ───────────────────────────────────────────
// Each of these was written twice before the phases were merged. The tests are
// the properties that keep them ONE rule, not restatements of the code.

describe('the folder a file resolves against', () => {
  it('always joins back to an absolute path when the file was absolute', () => {
    // The whole reason `dirname` exists: the bare head of `/main.py` is `''` and
    // of `C:\main.py` is `C:`, and both of those join RELATIVE — the sprite
    // silently resolves against the process's working directory instead.
    for (const path of ['/main.py', 'C:\\main.py', '/proj/code/play.py', 'C:\\proj\\play.py']) {
      const dir = dirname(path)
      expect(dir, path).not.toBeNull()
      expect(isAbsolutePath(joinPath(dir as string, 'eyes.spr')), path).toBe(true)
    }
  })

  it('is the folder the file is IN, and nothing when it is in none', () => {
    expect(dirname('/proj/code/play.py')).toBe('/proj/code')
    expect(dirname('untitled-1.py')).toBeNull()
    expect(dirname('')).toBeNull()
  })
})

describe('which candidate a reference means', () => {
  const candidates = ['/proj/code/eyes.spr', '/proj/eyes.spr']
  const exists =
    (...there: string[]) =>
    (path: string): 'yes' | 'no' =>
      there.includes(path) ? 'yes' : 'no'

  it('is the nearest one that exists — a farther namesake never wins', () => {
    expect(chooseSpriteCandidate(candidates, exists(...candidates)).path).toBe(candidates[0])
    expect(chooseSpriteCandidate(candidates, exists(candidates[1])).path).toBe(candidates[1])
    expect(chooseSpriteCandidate(candidates, exists()).path).toBeUndefined()
    expect(chooseSpriteCandidate([], exists()).index).toBe(-1)
  })

  it('an unchecked FARTHER candidate cannot unsettle a nearer one that exists', () => {
    // What "pending" is for: it means "do not call this broken yet", and a hit
    // already answers the question however little is known about the rest.
    const choice = chooseSpriteCandidate(candidates, (path) =>
      path === candidates[0] ? 'yes' : 'unknown'
    )
    expect(choice.path).toBe(candidates[0])
    expect(choice.pending).toBe(false)
  })

  it('is pending only while an unlooked-at candidate could still be the answer', () => {
    expect(chooseSpriteCandidate(candidates, () => 'unknown').pending).toBe(true)
    expect(chooseSpriteCandidate(candidates, () => 'no').pending).toBe(false)
  })
})

describe('one tokeniser, two questions', () => {
  /** Offset of a 1-based line/column in an LF-only source. */
  const offsetAt = (source: string, line: number, column: number): number => {
    const lines = source.split('\n')
    let offset = 0
    for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1
    return offset + column - 1
  }

  const source = [
    '# eyes.spr in a comment',
    '"""',
    'a docstring naming eyes.spr',
    '"""',
    'A = "eyes.spr"',
    "B = 'sprites/mouth.spr'  # trailing",
    'C = f"{stem}.spr"',
    'D = "unterminated.spr',
    'E = r"raw\\eyes.spr"'
  ].join('\n')

  it('the scanner and the cursor agree about where a literal is open', () => {
    // The anti-drift property. `findSpriteRefs` says "here is a reference";
    // `pythonLexState` is asked what the cursor just inside that quote sits in,
    // and must say the very same literal — same body offset, not a docstring.
    // Before #797 these were two scanners agreeing by hand.
    const refs = findSpriteRefs(source)
    expect(refs.map((r) => r.text)).toEqual(['eyes.spr', 'sprites/mouth.spr', 'raw\\eyes.spr'])
    for (const ref of refs) {
      const inside = offsetAt(source, ref.line, ref.startColumn + 1)
      const state = pythonLexState(source.slice(0, inside))
      expect(state.kind, ref.text).toBe('string')
      expect(state, ref.text).toMatchObject({ triple: false, bodyStart: inside })
    }
  })

  it('a comment and a docstring are nowhere a reference could sit, at any column', () => {
    // The other half of that agreement: the places `findSpriteRefs` refuses to
    // report are places the cursor rule refuses to offer in. A `.spr` named in
    // either is a mention, not a use — line 1 is the comment, line 3 the
    // docstring's body, and no column of either is a single-quoted literal.
    const lines = source.split('\n')
    for (const line of [1, 3]) {
      for (let column = 2; column <= lines[line - 1].length + 1; column++) {
        const state = pythonLexState(source.slice(0, offsetAt(source, line, column)))
        expect(state.kind === 'string' && !state.triple, `${line}:${column}`).toBe(false)
      }
    }
  })
})
