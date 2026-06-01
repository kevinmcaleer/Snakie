import { useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'snakie.theme'

function getInitialTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

/**
 * Theme state backed by CSS custom-property tokens. Sets `data-theme` on the
 * document root so all token overrides in `index.css` apply globally, and
 * persists the choice across restarts.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useLocalStorage<Theme>(STORAGE_KEY, getInitialTheme())

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = (): void => setTheme(theme === 'dark' ? 'light' : 'dark')

  return { theme, toggleTheme }
}
