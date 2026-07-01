import { useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'

// Two themes: the textured default (id `skeuomorph`, shown to users as "Light")
// and `dark`. The earlier flat `light` theme was removed; any persisted `light`
// value is migrated to `skeuomorph` on load.
export type Theme = 'dark' | 'skeuomorph'

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
export function useTheme(): {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
} {
  const [stored, setTheme] = useLocalStorage<Theme>(STORAGE_KEY, getInitialTheme())
  // Migrate the removed flat `light` theme to the textured "Light" (skeuomorph).
  const theme: Theme = (stored as string) === 'light' ? 'skeuomorph' : stored

  useEffect(() => {
    if ((stored as string) === 'light') setTheme('skeuomorph')
  }, [stored, setTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Flip between the Skeuomorph skin and the dark "lights out" theme.
  const toggleTheme = (): void => setTheme(theme === 'dark' ? 'skeuomorph' : 'dark')

  // `setTheme` is exposed so the Settings "Appearance" tab can pick any of the
  // three themes directly (the old toolbar toggle only flipped dark↔skeuomorph).
  return { theme, toggleTheme, setTheme }
}
