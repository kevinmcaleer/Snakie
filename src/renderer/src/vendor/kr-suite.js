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

export const KR_SUITE_VERSION = '1.0.0'

export const KR_ACCOUNT_URL = 'https://accounts.kevsrobots.com/account'

/** The apps in the suite, in switcher order. */
export const KR_APPS = Object.freeze([
  {
    id: 'learn',
    name: 'Learn',
    blurb: 'Courses, lessons and part guides',
    url: 'https://www.kevsrobots.com/learn/',
    mark: 'KR'
  },
  {
    id: 'projects',
    name: 'Projects',
    blurb: 'Your builds, steps and parts lists',
    url: 'https://www.kevsrobots.com/projects/hub',
    mark: 'P'
  },
  {
    id: 'snakie',
    name: 'Snakie',
    blurb: 'Write and run MicroPython',
    url: 'https://app.snakie.org/',
    mark: 'S'
  },
  {
    id: 'bettercad',
    name: 'BetterCAD',
    blurb: 'Design parts to 3D print',
    url: 'https://bettercad.kevsrobots.com/',
    mark: 'B'
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
const MARK_COLOURS = {
  learn: ['#C22032', '#FFFFFF'],
  projects: ['#D9A441', '#1C2230'],
  snakie: ['#26A269', '#FFFFFF'],
  bettercad: ['#7C3AED', '#FFFFFF']
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
          width: 36px;
          height: 36px;
          border-radius: 9px;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: 13px;
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
      const [bg, fg] = MARK_COLOURS[a.id]
      const current = a.id === here
      const t = target && !current ? ` target="${esc(target)}" rel="noopener"` : ''
      return `<li><a href="${esc(a.url)}"${t}${current ? ' aria-current="page"' : ''} data-app="${a.id}">
        <span class="ic" style="background:${bg};color:${fg}" aria-hidden="true">${esc(a.mark)}</span>
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
