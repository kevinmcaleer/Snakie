import { useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'

export type Theme = 'light' | 'dark' | 'skeuomorph'

// Bumped from `snakie.theme` so the new Skeuomorph default takes effect for
// users who had only ever run the previous dark-first build (their old value
// stays untouched under the legacy key).
const STORAGE_KEY = 'snakie.theme.v2'

// Snakie ships the "Skeuomorph" skin (brushed metal, green felt, cream ruled
// paper, recessed dark-glass console) as the default look. The toggle drops to
// the dark "lights out" theme and back; both are persisted.
function getInitialTheme(): Theme {
  return 'skeuomorph'
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

  // Flip between the Skeuomorph skin and the dark "lights out" theme.
  const toggleTheme = (): void => setTheme(theme === 'dark' ? 'skeuomorph' : 'dark')

  return { theme, toggleTheme }
}
