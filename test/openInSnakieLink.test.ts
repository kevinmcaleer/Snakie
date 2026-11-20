import { describe, expect, it } from 'vitest'
import { deepLinkFromArgv, parseDeepLink } from '../src/shared/deep-link'
import { resolveSharedLink, workspaceForSharedCode } from '../src/renderer/src/code-embed/shared-link'
import { writeBlocksFooter } from '../src/shared/blocks-doc'
import { encodeCode } from '../src/renderer/src/code-embed/share'
import type { Fetcher } from '../src/renderer/src/code-embed/source'

const noFetch: Fetcher = async (url) => {
  throw new Error(`unexpected fetch ${url}`)
}

describe('snakie:// links (kevsrobots.com#581)', () => {
  it('hands back the query and hash of an open link', () => {
    expect(parseDeepLink('snakie://open?name=blink.py#src=abc')).toEqual({
      search: '?name=blink.py',
      hash: '#src=abc'
    })
    expect(parseDeepLink('snakie://open/?gist=kev/123')).toEqual({ search: '?gist=kev/123', hash: '' })
    expect(parseDeepLink('SNAKIE://open#src=abc')).toEqual({ search: '', hash: '#src=abc' })
    expect(parseDeepLink('snakie:open?repo=a/b&path=main.py')).toEqual({
      search: '?repo=a/b&path=main.py',
      hash: ''
    })
  })

  it('refuses other schemes, other actions and empty links', () => {
    expect(parseDeepLink('https://app.snakie.org/?name=x#src=abc')).toBeNull()
    expect(parseDeepLink('snakie://delete?name=x')).toBeNull()
    expect(parseDeepLink('snakie://openx?name=x')).toBeNull()
    expect(parseDeepLink('snakie://open')).toBeNull()
    expect(parseDeepLink('snakie://open?#')).toBeNull()
    expect(parseDeepLink(42)).toBeNull()
    expect(parseDeepLink('snakie://open?code=' + 'a'.repeat(600 * 1024))).toBeNull()
  })

  it('finds the link in a command line', () => {
    expect(deepLinkFromArgv(['/opt/Snakie/snakie', '--no-sandbox', 'snakie://open?name=a.py'])).toBe(
      'snakie://open?name=a.py'
    )
    expect(deepLinkFromArgv(['/opt/Snakie/snakie', 'main.py'])).toBeNull()
  })
})

describe('resolveSharedLink', () => {
  const code = 'from machine import Pin\nled = Pin("LED", Pin.OUT)\nled.toggle()\n'

  it('opens lesson code from the hash, named by ?name=', async () => {
    const got = await resolveSharedLink('?name=blink.py', `#src=${encodeCode(code)}`, noFetch)
    expect(got).toEqual({ name: 'blink.py', code, note: 'Opened blink.py from the link' })
  })

  it('falls back to main.py with no name', async () => {
    const got = await resolveSharedLink('', `#src=${encodeCode(code)}`, noFetch)
    expect(got?.name).toBe('main.py')
  })

  it('says when the code was edited', async () => {
    const got = await resolveSharedLink('?name=a.py', `#code=${encodeCode(code)}`, noFetch)
    expect(got?.note).toBe('Opened a.py (edited from the original)')
  })

  it('opens ?code= inline, compressed or plain', async () => {
    expect((await resolveSharedLink(`?code=${encodeCode(code)}&name=x.py`, '', noFetch))?.code).toBe(code)
    const plain = new URLSearchParams({ code, name: 'x.py' }).toString()
    expect((await resolveSharedLink(`?${plain}`, '', noFetch))?.code).toBe(code)
  })

  it('uses the carried code for a gist without fetching', async () => {
    const got = await resolveSharedLink('?gist=kev/abc123&file=robot.py', `#src=${encodeCode(code)}`, noFetch)
    expect(got).toEqual({ name: 'robot.py', code, note: 'Opened robot.py from a GitHub gist' })
  })

  it('loads a repo file when no code is carried', async () => {
    const fetcher: Fetcher = async (url) => ({
      ok: url === 'https://raw.githubusercontent.com/kev/bot/main/src/main.py',
      status: 200,
      text: async () => code
    })
    const got = await resolveSharedLink('?repo=kev/bot&path=src/main.py&ref=main', '', fetcher)
    expect(got).toEqual({ name: 'main.py', code, note: 'Opened main.py from kev/bot' })
  })

  it('opens nothing for an ordinary address', async () => {
    expect(await resolveSharedLink('', '', noFetch)).toBeNull()
    expect(await resolveSharedLink('?name=x.py', '', noFetch)).toBeNull()
    expect(await resolveSharedLink('', '#src=!!!', noFetch)).toBeNull()
  })
})

describe('workspaceForSharedCode', () => {
  it('brings plain Python to Code from any other workspace', () => {
    expect(workspaceForSharedCode('print(1)', 'robot')).toBe('code')
    expect(workspaceForSharedCode('print(1)', 'board')).toBe('code')
    expect(workspaceForSharedCode('print(1)', 'blocks')).toBe('code')
    expect(workspaceForSharedCode('print(1)', 'code')).toBeNull()
  })

  it('shows a blocks file on the Blocks canvas', () => {
    const blocks = writeBlocksFooter('print(1)\n', { blocks: { languageVersion: 0, blocks: [] } } as never)
    expect(workspaceForSharedCode(blocks, 'robot')).toBe('blocks')
    expect(workspaceForSharedCode(blocks, 'blocks')).toBeNull()
  })
})
