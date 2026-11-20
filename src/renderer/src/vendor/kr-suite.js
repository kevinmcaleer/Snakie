/**
 * kevsrobots suite: the app switcher and the account button (kevsrobots.com#581).
 * =============================================================================
 * Two dependency-free web components shared by kevsrobots.com, Snakie and
 * BetterCAD, so the suite looks and behaves the same in every app:
 *
 *   <kr-app-switcher app="snakie" target="_blank"></kr-app-switcher>
 *     The 3 by 3 button. Opens a card listing Learn, Projects, Snakie and
 *     BetterCAD, with the app you are in marked. `target` is passed to the
 *     links (an editor opens the others in a new tab, so nothing unsaved is lost).
 *
 *   <kr-account app="snakie"></kr-account>
 *     Your kevsrobots account. Set `.user = { name, username, avatarUrl }` when
 *     signed in, or `null` when not. It fires `kr-sign-in` and `kr-sign-out`
 *     (bubbling, composed) and leaves signing in to the app. Put a sentence in
 *     `slot="note"` to say what signing in is for; add menu entries with
 *     `slot="items"`. The `busy` attribute disables its buttons.
 *
 * Theming: every colour reads a `--kr-*` custom property first (`--kr-ink`,
 * `--kr-ink-soft`, `--kr-line`, `--kr-panel`, `--kr-sunk`, `--kr-shadow`,
 * `--kr-accent`, `--kr-on-accent`, `--kr-focus`, `--kr-font-ui`), so an app can
 * map its own tokens onto them. Without them it uses the suite palette, light
 * or dark from `theme="light|dark"`, else the system setting.
 *
 * The canonical copy is this file, served at
 * https://www.kevsrobots.com/assets/suite/kr-suite.js. Snakie and BetterCAD
 * bundle a copy so they work offline and on the desktop: change it here first
 * and copy it across, bumping KR_SUITE_VERSION.
 */

export const KR_SUITE_VERSION = '1.1.0'

export const KR_ACCOUNT_URL = 'https://accounts.kevsrobots.com/account'

/**
 * Each app's icon, as a data URI so a bundled copy works offline. Generated
 * from icons/<id>.svg (served at https://www.kevsrobots.com/assets/suite/icons/):
 * edit the SVG, then regenerate these lines with
 * `node scripts/build-suite-icons.mjs`.
 */
export const KR_ICONS = Object.freeze({
  learn: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23FFFFFF'/%3E%3Crect x='.5' y='.5' width='63' height='63' rx='13.5' fill='none' stroke='%23C22032' stroke-opacity='.25'/%3E%3Cpath transform='translate(6 6.2) scale(0.10833)' fill='%23C22032' fill-rule='evenodd' d='M217.5 465.9C192.9 463.6 162.4 455.1 139.8 444.3C21.9 387.8 -26.8 248.3 30.4 131.5C69.8 51.1 150.3 1.0 240.0 1.0C392.8 1.0 503.9 144.5 465.9 292.7C437.8 402.4 331.3 476.6 217.5 465.9zM265.5 451.9C327.9 445.5 387.4 409.0 423.4 355.2C456.0 306.4 467.4 246.5 455.3 188.5C440.0 115.0 386.9 53.8 315.6 27.5C268.3 10.1 211.7 10.1 164.4 27.5C89.6 55.1 35.7 120.2 22.5 199.0C20.2 212.2 19.4 242.0 20.9 256.1C28.8 331.8 75.0 397.7 143.5 431.0C182.1 449.8 221.2 456.5 265.5 451.9zM218.0 440.3C211.9 439.6 197.7 437.1 197.2 436.6C196.8 436.1 185.1 304.8 185.5 304.2C185.7 303.9 314.4 426.0 314.8 426.9C315.6 429.0 281.4 437.8 264.0 440.0C256.1 440.9 225.8 441.2 218.0 440.3zM385.9 367.8C353.6 325.8 306.0 283.7 257.8 254.7C199.0 219.2 141.9 199.8 68.2 190.4L64.0 189.9 64.0 157.6L64.0 125.4 69.1 117.9C90.0 87.5 117.8 63.6 150.5 47.8C161.0 42.8 163.0 42.2 163.0 44.2C163.1 47.4 172.9 159.3 173.2 159.5C173.4 159.7 188.1 148.2 206.0 134.0L238.5 108.3 239.0 100.9L239.5 93.5 243.0 93.3C244.9 93.1 249.3 92.7 252.7 92.4L259.0 91.8 289.1 67.9C305.7 54.8 319.8 44.0 320.5 44.0C322.5 44.0 339.2 52.5 348.7 58.4C369.3 71.1 392.5 92.0 403.5 107.7C404.8 109.6 403.8 110.7 386.5 125.9L368.0 142.0 368.0 156.3C368.0 193.8 360.0 242.6 347.0 285.0L342.8 298.5 350.2 304.9C360.2 313.7 388.1 341.7 396.8 351.8C405.0 361.2 405.0 360.4 396.8 369.3L391.5 375.1 385.9 367.8zM340.4 273.9C356.0 226.8 363.1 182.9 363.4 133.5L363.5 107.5 353.5 105.2C323.5 98.5 296.1 95.1 264.0 94.3L240.5 93.7 240.3 115.4C240.0 149.1 235.8 185.7 228.7 215.9L226.3 225.9 235.4 230.0C263.1 242.8 297.8 263.7 323.0 282.9C328.8 287.3 333.8 291.0 334.2 291.0C334.5 291.0 337.3 283.3 340.4 273.9zM320.8 187.0C312.9 180.8 312.9 160.2 320.8 154.0C331.3 145.7 341.6 165.3 334.9 181.0C331.6 188.7 326.0 191.1 320.8 187.0zM269.7 170.9C267.1 169.4 264.0 162.5 263.3 157.0C262.1 146.6 267.9 135.0 274.5 135.0C278.5 135.0 283.5 140.7 285.0 147.0C288.6 162.2 279.4 176.6 269.7 170.9z'/%3E%3C/svg%3E",
  projects: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23D9A441'/%3E%3Crect x='17' y='14' width='30' height='39' rx='4' fill='%23FFF8E6' stroke='%231C2230' stroke-width='3'/%3E%3Crect x='24' y='10' width='16' height='8' rx='3' fill='%231C2230'/%3E%3Cg fill='none' stroke='%231C2230' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22.5 28l3 3 5-6M34.5 28.5h7M22.5 41l3 3 5-6M34.5 41.5h7'/%3E%3C/g%3E%3C/svg%3E",
  snakie: "data:image/svg+xml,%3Csvg width='1024' height='1024' viewBox='0 0 1024 1024' fill='none' xmlns='http://www.w3.org/2000/svg'%3E %3Cdefs%3E %3ClinearGradient id='bg' x1='0' y1='0' x2='1024' y2='1024' gradientUnits='userSpaceOnUse'%3E %3Cstop offset='0' stop-color='%2334d399'/%3E %3Cstop offset='0.55' stop-color='%2310b981'/%3E %3Cstop offset='1' stop-color='%230d9488'/%3E %3C/linearGradient%3E %3ClinearGradient id='body' x1='320' y1='240' x2='700' y2='780' gradientUnits='userSpaceOnUse'%3E %3Cstop offset='0' stop-color='%23ffffff'/%3E %3Cstop offset='1' stop-color='%23fde68a'/%3E %3C/linearGradient%3E %3C/defs%3E %3C!-- App-icon squircle background --%3E %3Crect x='0' y='0' width='1024' height='1024' rx='232' fill='url(%23bg)'/%3E %3C!-- soft inner highlight --%3E %3Crect x='0' y='0' width='1024' height='1024' rx='232' fill='%23ffffff' opacity='0.06'/%3E %3C!-- snake shadow --%3E %3Cpath d='M 668 372 C 668 286 408 268 380 392 C 352 516 700 532 668 654 C 640 762 414 778 360 694' stroke='%23064e3b' stroke-opacity='0.25' stroke-width='138' fill='none' stroke-linecap='round' stroke-linejoin='round' transform='translate(0,16)'/%3E %3C!-- snake body (S) --%3E %3Cpath d='M 668 372 C 668 286 408 268 380 392 C 352 516 700 532 668 654 C 640 762 414 778 360 694' stroke='url(%23body)' stroke-width='130' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E %3C!-- head --%3E %3Ccircle cx='668' cy='372' r='86' fill='url(%23body)'/%3E %3C!-- eye --%3E %3Ccircle cx='700' cy='348' r='17' fill='%230f3d2e'/%3E %3C!-- tongue --%3E %3Cpath d='M 724 408 L 762 452 M 762 452 L 792 440 M 762 452 L 788 470' stroke='%23ef4444' stroke-width='13' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E %3C/svg%3E",
  bettercad: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23F3EEFF'/%3E%3Cpath transform='translate(8 10) scale(2)' d='m12 2 8 4.5v9L12 20l-8-4.5v-9zM12 11l8-4.5M12 11 4 6.5M12 11v9' fill='none' stroke='%237C3AED' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
})

/** The apps in the suite, in switcher order. */
export const KR_APPS = Object.freeze([
  {
    id: 'learn',
    name: 'Learn',
    blurb: 'Courses, lessons and part guides',
    url: 'https://www.kevsrobots.com/learn/',
    mark: 'KR',
    icon: KR_ICONS.learn
  },
  {
    id: 'projects',
    name: 'Projects',
    blurb: 'Your builds, steps and parts lists',
    url: 'https://www.kevsrobots.com/projects/hub',
    mark: 'P',
    icon: KR_ICONS.projects
  },
  {
    id: 'snakie',
    name: 'Snakie',
    blurb: 'Write and run MicroPython',
    url: 'https://app.snakie.org/',
    mark: 'S',
    icon: KR_ICONS.snakie
  },
  {
    id: 'bettercad',
    name: 'BetterCAD',
    blurb: 'Design parts to 3D print',
    url: 'https://bettercad.kevsrobots.com/',
    mark: 'B',
    icon: KR_ICONS.bettercad
  }
])

/** Up to two letters for an avatar: "Kevin McAleer" → "KM", "kev" → "KE". */
export function initials(user) {
  if (!user) return ''
  const name = String(user.name || '').trim()
  if (name) {
    const words = name.split(/\s+/).filter(Boolean)
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)
    return letters.toUpperCase()
  }
  return String(user.username || '').trim().slice(0, 2).toUpperCase()
}

/** The name to show for a user: their name, else their username. */
export function displayName(user) {
  if (!user) return ''
  return String(user.name || '').trim() || String(user.username || '').trim()
}

/** Where to put a card under a button so it stays on screen. */
export function placeCard(button, card, viewport) {
  const gap = 6
  const margin = 8
  const width = Math.min(card.width, viewport.width - margin * 2)
  let left = button.left
  if (left + width > viewport.width - margin) left = Math.max(margin, button.right - width)
  let top = button.bottom + gap
  if (top + card.height > viewport.height - margin && button.top - gap - card.height >= margin) {
    top = button.top - gap - card.height
  }
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width) }
}

// ---------------------------------------------------------------------------
// The elements. Everything below needs a DOM; the helpers above don't, so the
// file can be imported in Node for tests.
// ---------------------------------------------------------------------------

const PALETTE = `
  --_ink: var(--kr-ink, #1C2230);
  --_soft: var(--kr-ink-soft, #5A6275);
  --_line: var(--kr-line, #E2E4E8);
  --_panel: var(--kr-panel, #FFFFFF);
  --_sunk: var(--kr-sunk, #EEF0EC);
  --_shadow: var(--kr-shadow, 0 1px 2px rgba(28,34,48,.06), 0 8px 24px rgba(28,34,48,.12));
  --_focus: var(--kr-focus, #2F6FEB);
`
const PALETTE_DARK = `
  --_ink: var(--kr-ink, #E8EAEE);
  --_soft: var(--kr-ink-soft, #A2A9B8);
  --_line: var(--kr-line, #2E323B);
  --_panel: var(--kr-panel, #1C1F26);
  --_sunk: var(--kr-sunk, #181B21);
  --_shadow: var(--kr-shadow, 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.4));
  --_focus: var(--kr-focus, #7AA7FF);
`

/** Accents chosen to hold 4.5:1 against white text. */
const ACCENTS = {
  learn: '#C22032',
  projects: '#C22032',
  snakie: '#1E7F52',
  bettercad: '#7C3AED'
}

const BASE_CSS = `
  :host {
    ${PALETTE}
    --_acc: var(--kr-accent, ${ACCENTS.learn});
    --_on-acc: var(--kr-on-accent, #FFFFFF);
    position: relative;
    display: inline-flex;
    align-items: center;
    font-family: var(--kr-font-ui, inherit);
    color: var(--_ink);
  }
  :host([app="snakie"]) { --_acc: var(--kr-accent, ${ACCENTS.snakie}); }
  :host([app="bettercad"]) { --_acc: var(--kr-accent, ${ACCENTS.bettercad}); }
  :host([theme="dark"]) { ${PALETTE_DARK} }
  @media (prefers-color-scheme: dark) {
    :host(:not([theme="light"])) { ${PALETTE_DARK} }
  }
  :host([hidden]) { display: none; }
  * { box-sizing: border-box; }
  .trigger {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--_line);
    border-radius: 8px;
    background: transparent;
    color: var(--_soft);
    cursor: pointer;
    font: inherit;
  }
  .trigger:hover, .trigger[aria-expanded="true"] { border-color: var(--_acc); color: var(--_ink); }
  .trigger:focus-visible, a:focus-visible, button:focus-visible {
    outline: 2px solid var(--_focus);
    outline-offset: 2px;
  }
  .card {
    position: fixed;
    z-index: var(--kr-z, 2000);
    width: 320px;
    max-height: calc(100vh - 16px);
    overflow: auto;
    padding: 8px;
    border: 1px solid var(--_line);
    border-radius: 12px;
    background: var(--_panel);
    color: var(--_ink);
    box-shadow: var(--_shadow);
    font-size: 14px;
    line-height: 1.4;
    text-align: left;
  }
  .card[hidden] { display: none; }
  .eyebrow {
    margin: 4px 8px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--_soft);
  }
  @media (prefers-reduced-motion: no-preference) {
    .card:not([hidden]) { animation: kr-in .12s ease-out; }
    @keyframes kr-in { from { opacity: 0; transform: translateY(-4px); } }
  }
`

const GRID_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  [2, 7, 12]
    .flatMap((y) => [2, 7, 12].map((x) => `<rect x="${x - 0.5}" y="${y - 0.5}" width="3" height="3" rx="0.8" fill="currentColor"/>`))
    .join('') +
  '</svg>'

const PERSON_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
  '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5c1.3-3.3 4-5 7.2-5s5.9 1.7 7.2 5"/></svg>'

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const HTMLElementBase = typeof HTMLElement === 'undefined' ? class {} : HTMLElement

/** A button that opens a card, with the suite's open/close rules. */
class KrPopup extends HTMLElementBase {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this._onDocPointer = (e) => {
      if (!e.composedPath().includes(this)) this.close()
    }
    this._onResize = () => this.close()
  }

  get open() {
    return !!this._card && !this._card.hidden
  }

  disconnectedCallback() {
    this._unlisten()
  }

  /** Subclasses render, then call this with the trigger and the card. */
  _wire(trigger, card) {
    this._trigger = trigger
    this._card = card
    trigger.addEventListener('click', () => (this.open ? this.close() : this.show()))
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !this.open) {
        e.preventDefault()
        this.show()
      }
    })
    card.addEventListener('keydown', (e) => this._cardKey(e))
    this.shadowRoot.addEventListener('focusout', (e) => {
      // Tabbing out of the card closes it. (A click elsewhere is the
      // pointerdown listener's job; relatedTarget is null then.)
      const to = e.relatedTarget
      if (this.open && to && !this.shadowRoot.contains(to) && !this.contains(to)) this.close()
    })
  }

  _items() {
    return [...this._card.querySelectorAll('a[href], button:not([disabled])')]
  }

  _cardKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close(true)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = this._items()
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(this.shadowRoot.activeElement)
    let next = 0
    if (e.key === 'End') next = items.length - 1
    else if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length
    else if (e.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1
    items[next].focus()
  }

  show() {
    if (this.open) return
    this._card.hidden = false
    this._trigger.setAttribute('aria-expanded', 'true')
    this._place()
    document.addEventListener('pointerdown', this._onDocPointer, true)
    window.addEventListener('resize', this._onResize)
    const first = this._items()[0]
    if (first) first.focus()
  }

  close(returnFocus = false) {
    if (!this._card || this._card.hidden) return
    this._card.hidden = true
    this._trigger.setAttribute('aria-expanded', 'false')
    this._unlisten()
    if (returnFocus) this._trigger.focus()
  }

  _unlisten() {
    if (typeof document === 'undefined') return
    document.removeEventListener('pointerdown', this._onDocPointer, true)
    window.removeEventListener('resize', this._onResize)
  }

  _place() {
    const b = this._trigger.getBoundingClientRect()
    const c = this._card.getBoundingClientRect()
    const at = placeCard(
      b,
      { width: c.width || 320, height: c.height || 0 },
      { width: window.innerWidth, height: window.innerHeight }
    )
    this._card.style.left = `${at.left}px`
    this._card.style.top = `${at.top}px`
    this._card.style.width = `${at.width}px`
  }
}

let nextId = 0

export class KrAppSwitcher extends KrPopup {
  static get observedAttributes() {
    return ['app', 'target']
  }

  connectedCallback() {
    if (!this._trigger) this._render()
  }

  attributeChangedCallback() {
    if (this._trigger) this._renderList()
  }

  _render() {
    const id = `kr-apps-${++nextId}`
    this.shadowRoot.innerHTML = `
      <style>
        ${BASE_CSS}
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
        a {
          display: grid;
          grid-template-columns: 36px 1fr;
          gap: 12px;
          align-items: center;
          padding: 8px;
          border-radius: 8px;
          color: inherit;
          text-decoration: none;
        }
        a:hover, a:focus-visible { background: var(--_sunk); }
        a[aria-current] { background: var(--_sunk); }
        .ic {
          display: block;
          width: 36px;
          height: 36px;
          border-radius: 9px;
        }
        b { display: block; font-size: 14px; font-weight: 700; }
        .blurb { display: block; font-size: 12.5px; color: var(--_soft); }
        .here { font-weight: 500; color: var(--_soft); font-size: 12px; }
      </style>
      <button class="trigger" type="button" part="button" aria-haspopup="true" aria-expanded="false"
        aria-controls="${id}" aria-label="Switch kevsrobots app" title="kevsrobots apps">${GRID_ICON}</button>
      <nav class="card" id="${id}" part="card" aria-label="kevsrobots apps" hidden>
        <div class="eyebrow" aria-hidden="true">kevsrobots apps</div>
        <ul></ul>
      </nav>`
    this._wire(this.shadowRoot.querySelector('.trigger'), this.shadowRoot.querySelector('.card'))
    this._renderList()
  }

  _renderList() {
    const here = this.getAttribute('app')
    const target = this.getAttribute('target')
    const list = this.shadowRoot.querySelector('ul')
    list.innerHTML = KR_APPS.map((a) => {
      const current = a.id === here
      const t = target && !current ? ` target="${esc(target)}" rel="noopener"` : ''
      return `<li><a href="${esc(a.url)}"${t}${current ? ' aria-current="page"' : ''} data-app="${a.id}">
        <img class="ic" src="${a.icon}" alt="" width="36" height="36" draggable="false">
        <span><b>${esc(a.name)}${current ? ' <span class="here">· you are here</span>' : ''}</b>
        <span class="blurb">${esc(a.blurb)}</span></span></a></li>`
    }).join('')
    for (const link of list.querySelectorAll('a[aria-current]')) {
      // You are already here: just close.
      link.addEventListener('click', (e) => {
        e.preventDefault()
        this.close(true)
      })
    }
    for (const link of list.querySelectorAll('a:not([aria-current])')) {
      link.addEventListener('click', () => this.close())
    }
  }
}

export class KrAccount extends KrPopup {
  static get observedAttributes() {
    return ['busy', 'account-href']
  }

  constructor() {
    super()
    this._user = null
  }

  get user() {
    return this._user
  }

  set user(value) {
    this._user = value && (value.name || value.username) ? value : null
    this.toggleAttribute('signed-in', !!this._user)
    if (this._trigger) this._renderState()
  }

  connectedCallback() {
    if (!this._trigger) this._render()
  }

  attributeChangedCallback() {
    if (this._trigger) this._renderState()
  }

  _render() {
    const id = `kr-account-${++nextId}`
    this.shadowRoot.innerHTML = `
      <style>
        ${BASE_CSS}
        .trigger { border-radius: 50%; overflow: hidden; }
        .trigger.in { border-color: transparent; background: var(--kr-gold, #D9A441); color: #1C2230; font-weight: 700; font-size: 12px; }
        .trigger img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .card { width: 280px; }
        .who { padding: 8px; display: grid; gap: 2px; }
        .who b { font-size: 14px; }
        .who span, .note { color: var(--_soft); font-size: 13px; }
        .note { margin: 4px 8px 10px; }
        hr { border: 0; border-top: 1px solid var(--_line); margin: 6px 0; }
        .item {
          display: block;
          width: 100%;
          padding: 8px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          text-decoration: none;
          cursor: pointer;
        }
        .item:hover, .item:focus-visible { background: var(--_sunk); }
        .primary {
          display: block;
          width: calc(100% - 16px);
          margin: 0 8px 8px;
          padding: 8px 12px;
          border: 0;
          border-radius: 8px;
          background: var(--_acc);
          color: var(--_on-acc);
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        button[disabled] { opacity: .6; cursor: default; }
        ::slotted([slot="items"]) { display: block; }
      </style>
      <button class="trigger" type="button" part="button" aria-haspopup="true" aria-expanded="false" aria-controls="${id}"></button>
      <div class="card" id="${id}" part="card" role="group" hidden></div>`
    this._wire(this.shadowRoot.querySelector('.trigger'), this.shadowRoot.querySelector('.card'))
    this._renderState()
  }

  _renderState() {
    const trigger = this._trigger
    const card = this._card
    const user = this._user
    const busy = this.hasAttribute('busy')
    const href = this.getAttribute('account-href') || KR_ACCOUNT_URL
    trigger.classList.toggle('in', !!user)
    if (user) {
      const name = displayName(user)
      trigger.setAttribute('aria-label', `Your kevsrobots account: ${name}`)
      trigger.title = `Signed in as ${name}`
      trigger.innerHTML = user.avatarUrl
        ? `<img src="${esc(user.avatarUrl)}" alt="">`
        : `<span aria-hidden="true">${esc(initials(user))}</span>`
      const img = trigger.querySelector('img')
      if (img) img.addEventListener('error', () => (trigger.innerHTML = `<span aria-hidden="true">${esc(initials(user))}</span>`))
      card.setAttribute('aria-label', 'Your kevsrobots account')
      card.innerHTML = `
        <div class="who"><b>${esc(name)}</b>${user.username && user.username !== name ? `<span>@${esc(user.username)}</span>` : ''}</div>
        <hr>
        <a class="item" href="${esc(href)}" target="_blank" rel="noopener">Your kevsrobots account</a>
        <slot name="items"></slot>
        <hr>
        <button class="item" type="button" data-act="sign-out"${busy ? ' disabled' : ''}>Sign out</button>`
    } else {
      trigger.setAttribute('aria-label', 'kevsrobots account: not signed in')
      trigger.title = 'Not signed in'
      trigger.innerHTML = PERSON_ICON
      card.setAttribute('aria-label', 'kevsrobots account')
      card.innerHTML = `
        <div class="who"><b>Not signed in</b></div>
        <p class="note"><slot name="note">Sign in with your kevsrobots account.</slot></p>
        <button class="primary" type="button" data-act="sign-in"${busy ? ' disabled' : ''}>${busy ? 'Waiting for kevsrobots…' : 'Sign in with kevsrobots'}</button>`
    }
    const act = card.querySelector('[data-act]')
    act.addEventListener('click', () => {
      const name = act.dataset.act === 'sign-in' ? 'kr-sign-in' : 'kr-sign-out'
      this.close(true)
      this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }))
    })
  }
}

if (typeof customElements !== 'undefined') {
  if (!customElements.get('kr-app-switcher')) customElements.define('kr-app-switcher', KrAppSwitcher)
  if (!customElements.get('kr-account')) customElements.define('kr-account', KrAccount)
}
