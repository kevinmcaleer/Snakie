import { useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'snakie.theme'

// Snakie is a dark-first retro app: default to dark regardless of the OS
// preference. Users can still toggle to the lighter retro variant (persisted).
function getInitialTheme(): Theme {
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
