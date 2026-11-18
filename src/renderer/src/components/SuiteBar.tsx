import { useCallback, useEffect, useRef, useState } from 'react'
import '../vendor/kr-suite.js'
import type { KrAccount, KrSuiteUser } from '../vendor/kr-suite.js'
import type { KrStatus } from '../../../shared/kevsrobots-account'
import './SuiteBar.css'

/**
 * THE KEVSROBOTS SUITE PIECES OF THE TOOLBAR (kevsrobots.com#581, #1310)
 * =======================================================================
 * The app switcher (Learn, Projects, Snakie, BetterCAD) and the kevsrobots
 * account button, the same two components kevsrobots.com and BetterCAD use
 * (`vendor/kr-suite.js`, a bundled copy so they work offline and on the desktop).
 *
 * Snakie never asks you to sign in from here unprompted: the account button
 * shows you're signed out until you choose to sign in, from it or from Send to
 * kevsrobots. Signing in is only for sharing; code is never sent.
 */

/** Fired after signing in or out anywhere in Snakie, so the account button follows. */
export const KR_ACCOUNT_CHANGED = 'snakie:kevsrobots-account'

export function announceAccountChange(): void {
  window.dispatchEvent(new CustomEvent(KR_ACCOUNT_CHANGED))
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'kr-app-switcher': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        app?: string
        target?: string
        theme?: string
      }
      'kr-account': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        app?: string
        theme?: string
        busy?: string
      }
    }
  }
}

/** `light` or `dark`, following Snakie's own theme on the document root. */
function useSuiteTheme(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

/** What the account button shows for a sign-in status. */
export function suiteUser(status: KrStatus): KrSuiteUser | null {
  if (!status.signedIn) return null
  // Signed in, but kevsrobots couldn't be reached to say who as: still signed in.
  if (!status.user) return { name: 'kevsrobots account' }
  return {
    name: status.user.name,
    username: status.user.username,
    avatarUrl: status.user.picture
  }
}

export function SuiteSwitcher(): JSX.Element {
  const theme = useSuiteTheme()
  // Other apps open in a new tab (a new browser window on the desktop), so
  // nothing unsaved here is lost.
  return <kr-app-switcher className="suite-switcher" app="snakie" target="_blank" theme={theme} />
}

export function SuiteAccount(): JSX.Element | null {
  const api = window.api?.kevsrobots
  const theme = useSuiteTheme()
  const ref = useRef<KrAccount | null>(null)
  const [status, setStatus] = useState<KrStatus>({ signedIn: false })
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) return
    try {
      setStatus(await api.status())
    } catch {
      setStatus({ signedIn: false })
    }
  }, [api])

  useEffect(() => {
    void refresh()
    const onChange = (): void => void refresh()
    window.addEventListener(KR_ACCOUNT_CHANGED, onChange)
    return () => window.removeEventListener(KR_ACCOUNT_CHANGED, onChange)
  }, [refresh])

  useEffect(() => {
    if (ref.current) ref.current.user = suiteUser(status)
  }, [status])

  useEffect(() => {
    const el = ref.current
    if (!el || !api) return
    const signIn = (): void => {
      // Straight from the click: the web build opens its sign-in popup here.
      setBusy(true)
      void api
        .signIn()
        .then((res) => {
          if (res.ok) setStatus(res.value)
        })
        .finally(() => {
          setBusy(false)
          announceAccountChange()
        })
    }
    const signOut = (): void => {
      setBusy(true)
      void api
        .signOut()
        .catch(() => undefined)
        .finally(() => {
          setBusy(false)
          setStatus({ signedIn: false })
          announceAccountChange()
        })
    }
    el.addEventListener('kr-sign-in', signIn)
    el.addEventListener('kr-sign-out', signOut)
    return () => {
      el.removeEventListener('kr-sign-in', signIn)
      el.removeEventListener('kr-sign-out', signOut)
    }
  }, [api])

  if (!api) return null
  return (
    <kr-account
      ref={ref as React.Ref<HTMLElement>}
      className="suite-account"
      app="snakie"
      theme={theme}
      busy={busy ? '' : undefined}
    >
      <span slot="note">Only needed to send wiring to your kevsrobots projects. Your code is never sent.</span>
    </kr-account>
  )
}
