import { describe, it, expect, vi, afterEach } from 'vitest'
import { reportError, reporter, errorMessage } from '../src/renderer/src/lib/report-error'

describe('errorMessage (#225)', () => {
  it('extracts a message from Error / string / other', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
  })
})

describe('reportError (#225)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('ALWAYS console.warns with the [context] tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = new Error('nope')
    reportError('servo send', err)
    expect(warn).toHaveBeenCalledWith('[servo send]', err)
  })

  it('does NOT surface to the status bar when notify is unset', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dispatch = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: dispatch })
    reportError('teleop send', new Error('x'))
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('surfaces to the status bar via snakie:status when notify is set', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events: CustomEvent[] = []
    vi.stubGlobal('window', {
      dispatchEvent: (e: CustomEvent) => {
        events.push(e)
        return true
      }
    })
    reportError('run', new Error('unreachable'), { notify: "Couldn't reach the board." })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('snakie:status')
    expect((events[0].detail as { text: string }).text).toBe("Couldn't reach the board.")
    // tooltip carries the raw error message.
    expect((events[0].detail as { tooltip: string }).tooltip).toBe('unreachable')
  })

  it('notify:true posts a generic "<context>: <message>"', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events: CustomEvent[] = []
    vi.stubGlobal('window', { dispatchEvent: (e: CustomEvent) => (events.push(e), true) })
    reportError('save file', new Error('EACCES'), { notify: true })
    expect((events[0].detail as { text: string }).text).toBe('save file: EACCES')
  })

  it('reporter() returns a drop-in .catch handler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = reporter('led send')
    handler(new Error('boom'))
    expect(warn).toHaveBeenCalledWith('[led send]', expect.any(Error))
  })
})
