import { describe, expect, it } from 'vitest'
import { parseEmbedParams, parseLines, sliceLines } from '../src/renderer/src/code-embed/params'
import {
  EmbedLoadError,
  gistFileAnchor,
  githubUrlFor,
  loadProgram,
  openInSnakieUrl,
  pickGistFile,
  type Fetcher
} from '../src/renderer/src/code-embed/source'
import { decodeCode, encodeCode } from '../src/renderer/src/code-embed/share'
import { preferredHeight, MIN_BLOCKS_H, BAR_H, FOOTER_H, REPL_H } from '../src/renderer/src/code-embed/layout'
import { MemoryStorage } from '../src/renderer/src/code-embed/memory-storage'

/** A fetcher answering from a table; anything else is a 404. */
function fakeFetch(table: Record<string, { status?: number; body: string }>): Fetcher & { calls: string[] } {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(url)
    const hit = table[url]
    const status = hit ? hit.status ?? 200 : 404
    return { ok: status >= 200 && status < 300, status, text: async () => hit?.body ?? '' }
  }) as Fetcher & { calls: string[] }
  f.calls = calls
  return f
}

describe('embed URL params (#1286)', () => {
  it('reads a gist with its file and defaults the rest', () => {
    const p = parseEmbedParams('?gist=87a7e27a&file=main.py')
    expect(p.source).toEqual({ kind: 'gist', id: '87a7e27a', user: null, file: 'main.py', revision: null })
    expect(p).toMatchObject({ view: null, toolbox: 'simple', run: true, autorun: false, theme: 'skeuomorph', height: null, engine: 'micropython' })
  })

  it('accepts a whole gist URL, keeping the user', () => {
    const p = parseEmbedParams('?gist=' + encodeURIComponent('https://gist.github.com/kevinmcaleer/abc123'))
    expect(p.source).toMatchObject({ kind: 'gist', id: 'abc123', user: 'kevinmcaleer' })
  })

  it('reads a repo file; no ref means "try main then master"', () => {
    const p = parseEmbedParams('?repo=kevinmcaleer/burgerbot&path=/src/main.py&lines=10-40')
    expect(p.source).toEqual({ kind: 'repo', owner: 'kevinmcaleer', name: 'burgerbot', path: 'src/main.py', ref: null })
    expect(p.lines).toEqual({ from: 10, to: 40 })
  })

  it('refuses a repo path that climbs out', () => {
    expect(parseEmbedParams('?repo=a/b&path=../secret').source.kind).toBe('none')
  })

  it('maps the toolbox, theme, height and engine values', () => {
    const p = parseEmbedParams('?code=x&toolbox=advanced&theme=dark&height=9999&run=0&autorun=1&view=split')
    expect(p).toMatchObject({ toolbox: 'advanced', theme: 'dark', height: 2000, run: false, autorun: true, view: 'split' })
    expect(parseEmbedParams('?code=x&height=10').height).toBe(160)
  })

  it('forces code view for Pyodide, and keeps only sane package names', () => {
    const p = parseEmbedParams('?code=x&engine=pyodide&view=blocks&packages=numpy,pandas,bad name,<x>')
    expect(p.view).toBe('code')
    expect(p.packages).toEqual(['numpy', 'pandas'])
  })

  it('parses and applies line ranges', () => {
    expect(parseLines('3')).toEqual({ from: 3, to: 3 })
    expect(parseLines('3-')).toEqual({ from: 3, to: Number.MAX_SAFE_INTEGER })
    expect(parseLines('5-2')).toBeNull()
    expect(sliceLines('a\nb\nc\nd', { from: 2, to: 3 })).toBe('b\nc')
    expect(sliceLines('a\nb', { from: 2, to: Number.MAX_SAFE_INTEGER })).toBe('b')
  })
})

describe('loading code from GitHub (#1286)', () => {
  it('loads the named file from the Gist API, and fills in the owner', async () => {
    const f = fakeFetch({
      'https://api.github.com/gists/abc': {
        body: JSON.stringify({ owner: { login: 'kev' }, files: { 'README.md': { content: '#' }, 'main.py': { content: 'print(1)' } } })
      }
    })
    const p = await loadProgram({ kind: 'gist', id: 'abc', user: null, file: null, revision: null }, f)
    expect(p.name).toBe('main.py')
    expect(p.code).toBe('print(1)')
    expect(p.githubUrl).toBe('https://gist.github.com/kev/abc#file-main-py')
  })

  it('falls back to the raw gist file when the API is rate-limited', async () => {
    const f = fakeFetch({
      'https://api.github.com/gists/abc': { status: 403, body: '' },
      'https://gist.githubusercontent.com/anonymous/abc/raw/main.py': { body: 'print(2)' }
    })
    const p = await loadProgram({ kind: 'gist', id: 'abc', user: null, file: 'main.py', revision: null }, f)
    expect(p.code).toBe('print(2)')
  })

  it('says why when a rate-limited gist has no file name to fall back on', async () => {
    const f = fakeFetch({ 'https://api.github.com/gists/abc': { status: 403, body: '' } })
    await expect(loadProgram({ kind: 'gist', id: 'abc', user: null, file: null, revision: null }, f)).rejects.toBeInstanceOf(EmbedLoadError)
  })

  it('tries main, then master, for a repo file with no ref', async () => {
    const f = fakeFetch({ 'https://raw.githubusercontent.com/o/r/master/src/main.py': { body: 'x = 1' } })
    const p = await loadProgram({ kind: 'repo', owner: 'o', name: 'r', path: 'src/main.py', ref: null }, f)
    expect(f.calls).toEqual([
      'https://raw.githubusercontent.com/o/r/main/src/main.py',
      'https://raw.githubusercontent.com/o/r/master/src/main.py'
    ])
    expect(p).toMatchObject({ name: 'main.py', code: 'x = 1', githubUrl: 'https://github.com/o/r/blob/master/src/main.py' })
  })

  it('reports a missing repo file with a GitHub link', async () => {
    const f = fakeFetch({})
    const err = await loadProgram({ kind: 'repo', owner: 'o', name: 'r', path: 'a.py', ref: 'dev' }, f).catch((e) => e)
    expect(err).toBeInstanceOf(EmbedLoadError)
    expect(err.githubUrl).toBe('https://github.com/o/r/blob/dev/a.py')
  })

  it('takes inline code encoded or plain', async () => {
    const encoded = await loadProgram({ kind: 'inline', code: encodeCode('print("hi")'), name: 'a.py' }, fakeFetch({}))
    expect(encoded.code).toBe('print("hi")')
    const plain = await loadProgram({ kind: 'inline', code: 'print(3)', name: 'a.py' }, fakeFetch({}))
    expect(plain.code).toBe('print(3)')
  })

  it('picks a gist file sensibly', () => {
    const files = { 'notes.txt': {}, 'Robot.PY': {} }
    expect(pickGistFile(files, null)).toBe('Robot.PY')
    expect(pickGistFile(files, 'robot.py')).toBe('Robot.PY')
    expect(pickGistFile(files, 'nope.py')).toBeNull()
    expect(gistFileAnchor('my_robot.py')).toBe('file-my-robot-py')
  })
})

describe('links out of the embed (#1286, #1287)', () => {
  it('links repo files with their line range', () => {
    expect(githubUrlFor({ kind: 'repo', owner: 'o', name: 'r', path: 'a b.py', ref: 'main' }, { from: 3, to: 9 })).toBe(
      'https://github.com/o/r/blob/main/a%20b.py#L3-L9'
    )
  })

  it('opens the original in Snakie with no hash, and edits in the hash', () => {
    const src = { kind: 'gist' as const, id: 'abc', user: 'kev', file: 'main.py', revision: null }
    expect(openInSnakieUrl('https://app.snakie.org', src, null, 'main.py')).toBe(
      'https://app.snakie.org/?gist=kev%2Fabc&file=main.py'
    )
    const url = openInSnakieUrl('https://app.snakie.org', src, 'print("edited")', 'main.py')
    const payload = /#code=(.+)$/.exec(url)?.[1] ?? ''
    expect(decodeCode(payload)).toBe('print("edited")')
  })

  it('round-trips code through the URL format, and rejects junk', () => {
    const code = 'from machine import Pin\nled = Pin(25, Pin.OUT)\n' + '# ünïcode ✓\n'.repeat(20)
    expect(decodeCode(encodeCode(code))).toBe(code)
    expect(decodeCode('not valid!')).toBeNull()
    expect(decodeCode('AAAA')).toBeNull()
  })
})

describe('embed sizing (#1288)', () => {
  it('grows with the code, within limits, and gives blocks room', () => {
    const small = preferredHeight({ lines: 3, view: 'code', repl: true, plots: false, error: false })
    const big = preferredHeight({ lines: 400, view: 'code', repl: true, plots: false, error: false })
    expect(small).toBeLessThan(big)
    expect(big).toBe(BAR_H + 560 + REPL_H + FOOTER_H)
    expect(preferredHeight({ lines: 3, view: 'blocks', repl: false, plots: false, error: false })).toBe(BAR_H + MIN_BLOCKS_H + FOOTER_H)
  })
})

describe('the embed\'s private storage', () => {
  it('behaves like Storage and starts from its seed', () => {
    const s = new MemoryStorage({ a: '1' })
    expect(s.getItem('a')).toBe('1')
    s.setItem('b', '2')
    expect(s.length).toBe(2)
    expect(s.key(1)).toBe('b')
    s.removeItem('a')
    expect(s.getItem('a')).toBeNull()
  })
})
