// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KrAccount, KrAppSwitcher } from '../src/renderer/src/vendor/kr-suite.js'
import { KR_ACCOUNT_CHANGED, SuiteAccount, suiteUser } from '../src/renderer/src/components/SuiteBar'
import { KrAppSwitcher as SuiteSwitcher } from '../src/renderer/src/components/KrAppSwitcher'
import type { KevsrobotsApi, KrStatus } from '../src/shared/kevsrobots-account'

/**
 * THE KEVSROBOTS SUITE IN THE TOOLBAR (kevsrobots.com#581)
 * =============================================================================
 * The app switcher and the account button are the same web components
 * kevsrobots.com and BetterCAD use. Snakie bundles a copy; the account button
 * shows you are signed out until YOU sign in, from it or from Send to
 * kevsrobots, and it never asks on its own.
 */
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const shadow = (el: Element): ShadowRoot => (el as HTMLElement).shadowRoot as ShadowRoot
const flush = (): Promise<void> => act(async () => await new Promise((r) => setTimeout(r, 0)))

let host: HTMLElement
let root: Root

beforeEach(() => {
  document.body.replaceChildren()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  delete (window as unknown as { api?: unknown }).api
  document.documentElement.removeAttribute('data-theme')
})

function fakeApi(start: KrStatus): KevsrobotsApi & { status: ReturnType<typeof vi.fn> } {
  let now = start
  return {
    status: vi.fn(async () => now),
    signIn: vi.fn(async () => {
      now = { signedIn: true, user: { username: 'kev', name: 'Kevin McAleer', picture: null, profileUrl: '' } }
      return { ok: true as const, value: now }
    }),
    signOut: vi.fn(async () => {
      now = { signedIn: false }
    }),
    listProjects: vi.fn(),
    sendWiring: vi.fn()
  } as unknown as KevsrobotsApi & { status: ReturnType<typeof vi.fn> }
}

describe('the app switcher', () => {
  it('lists the four apps, marks Snakie as where you are, and opens the others in a new tab', () => {
    act(() => root.render(<SuiteSwitcher />))
    const el = host.querySelector('kr-app-switcher') as KrAppSwitcher
    const links = [...shadow(el).querySelectorAll('a')]
    expect(links.map((a) => a.dataset.app)).toEqual(['learn', 'projects', 'snakie', 'bettercad'])
    const here = links.find((a) => a.getAttribute('aria-current'))
    expect(here?.dataset.app).toBe('snakie')
    expect(here?.hasAttribute('target')).toBe(false)
    for (const a of links.filter((l) => l !== here)) expect(a.getAttribute('target')).toBe('_blank')
  })

  it('opens from its button, and Esc closes it and gives focus back', () => {
    act(() => root.render(<SuiteSwitcher />))
    const el = host.querySelector('kr-app-switcher') as KrAppSwitcher
    const button = shadow(el).querySelector('button') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('Switch kevsrobots app')
    button.click()
    expect(el.open).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const card = shadow(el).querySelector('nav') as HTMLElement
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(el.open).toBe(false)
    expect(shadow(el).activeElement).toBe(button)
  })

  it('closes on a click anywhere else', () => {
    act(() => root.render(<SuiteSwitcher />))
    const el = host.querySelector('kr-app-switcher') as KrAppSwitcher
    el.show()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    expect(el.open).toBe(false)
  })

  it("follows Snakie's theme", async () => {
    document.documentElement.setAttribute('data-theme', 'skeuomorph')
    act(() => root.render(<SuiteSwitcher />))
    const el = host.querySelector('kr-app-switcher') as HTMLElement
    expect(el.getAttribute('theme')).toBe('light')
    document.documentElement.setAttribute('data-theme', 'dark')
    await flush()
    expect(el.getAttribute('theme')).toBe('dark')
  })
})

describe('the account button', () => {
  it('shows signed out, with what signing in is for, and asks nothing until you press it', async () => {
    const api = fakeApi({ signedIn: false })
    ;(window as unknown as { api: unknown }).api = { kevsrobots: api }
    act(() => root.render(<SuiteAccount />))
    await flush()
    const el = host.querySelector('kr-account') as KrAccount
    expect(el.user).toBeNull()
    expect(shadow(el).querySelector('button')?.getAttribute('aria-label')).toBe('kevsrobots account: not signed in')
    expect(el.textContent).toContain('Your code is never sent')
    expect(api.signIn).not.toHaveBeenCalled()
  })

  it('signs in when you choose to, then shows who you are', async () => {
    const api = fakeApi({ signedIn: false })
    ;(window as unknown as { api: unknown }).api = { kevsrobots: api }
    act(() => root.render(<SuiteAccount />))
    await flush()
    const el = host.querySelector('kr-account') as KrAccount
    el.show()
    const signIn = shadow(el).querySelector('[data-act="sign-in"]') as HTMLButtonElement
    expect(signIn.textContent).toBe('Sign in with kevsrobots')
    act(() => signIn.click())
    await flush()
    await flush()
    expect(api.signIn).toHaveBeenCalledTimes(1)
    expect(el.user).toMatchObject({ name: 'Kevin McAleer', username: 'kev' })
    expect(shadow(el).querySelector('button')?.textContent).toBe('KM')
  })

  it('signs out', async () => {
    const api = fakeApi({ signedIn: true, user: { username: 'kev', name: 'Kev', picture: null, profileUrl: '' } })
    ;(window as unknown as { api: unknown }).api = { kevsrobots: api }
    act(() => root.render(<SuiteAccount />))
    await flush()
    const el = host.querySelector('kr-account') as KrAccount
    expect(el.user).not.toBeNull()
    act(() => (shadow(el).querySelector('[data-act="sign-out"]') as HTMLButtonElement).click())
    await flush()
    await flush()
    expect(api.signOut).toHaveBeenCalledTimes(1)
    expect(el.user).toBeNull()
  })

  it('catches up when Send to kevsrobots signs you in', async () => {
    const api = fakeApi({ signedIn: false })
    ;(window as unknown as { api: unknown }).api = { kevsrobots: api }
    act(() => root.render(<SuiteAccount />))
    await flush()
    expect(api.status).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new CustomEvent(KR_ACCOUNT_CHANGED))
    await flush()
    expect(api.status).toHaveBeenCalledTimes(2)
  })

  it('stays signed in when kevsrobots could not say who as', () => {
    expect(suiteUser({ signedIn: true })).toEqual({ name: 'kevsrobots account' })
    expect(suiteUser({ signedIn: false })).toBeNull()
  })
})

describe('the toolbar', () => {
  it('has the switcher by the brand and the account at the far right', () => {
    const toolbar = readFileSync(join(__dirname, '../src/renderer/src/components/Toolbar.tsx'), 'utf8')
    const brand = toolbar.slice(toolbar.indexOf('toolbar__brand"'))
    expect(brand.slice(0, brand.indexOf('</div>'))).toContain('<KrAppSwitcher />')
    expect(toolbar).toMatch(/toolbar__side--end">\s*<SuiteAccount \/>/)
  })
})
