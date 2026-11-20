/**
 * Types for the kevsrobots suite components (kevsrobots.com#581). The script is
 * a copy of https://www.kevsrobots.com/assets/suite/kr-suite.js, bundled so the
 * switcher works offline and on the desktop. Change it there first, then copy it.
 */
export const KR_SUITE_VERSION: string
export const KR_ACCOUNT_URL: string
export interface KrSuiteApp {
  id: 'learn' | 'projects' | 'snakie' | 'bettercad'
  name: string
  blurb: string
  url: string
  mark: string
  icon: string
}
export const KR_ICONS: Readonly<Record<KrSuiteApp['id'], string>>
export const KR_APPS: readonly KrSuiteApp[]
export interface KrSuiteUser {
  name?: string
  username?: string
  avatarUrl?: string | null
}
export function initials(user: KrSuiteUser | null): string
export function displayName(user: KrSuiteUser | null): string
export function placeCard(
  button: { left: number; right: number; top: number; bottom: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number; width: number }
export class KrAppSwitcher extends HTMLElement {
  readonly open: boolean
  show(): void
  close(returnFocus?: boolean): void
}
export class KrAccount extends HTMLElement {
  user: KrSuiteUser | null
  readonly open: boolean
  show(): void
  close(returnFocus?: boolean): void
}
