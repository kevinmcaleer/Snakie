import { useEffect, useState } from 'react'
// The kevsrobots suite's shared web components (kevinmcaleer/kevsrobots.com#581).
// Vendored so the switcher works offline and in the desktop app: the canonical
// copy is kevsrobots.com/web/assets/suite/kr-suite.js. Update it there first,
// then copy it here.
import '../vendor/kr-suite.js'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'kr-app-switcher': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        app?: string
        target?: string
        theme?: 'light' | 'dark'
      }
    }
  }
}

/** Snakie's theme, as the suite components name it: `dark`, else `light`. */
function suiteTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/**
 * The KEVSROBOTS APPS switcher: the 3 by 3 button that lists Learn, Projects,
 * Snakie and BetterCAD, with Snakie marked "you are here". The other apps open
 * in a new tab so nothing unsaved in the editor is lost.
 */
export function KrAppSwitcher(): JSX.Element {
  const [theme, setTheme] = useState(suiteTheme)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(suiteTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return <kr-app-switcher app="snakie" target="_blank" theme={theme} />
}
