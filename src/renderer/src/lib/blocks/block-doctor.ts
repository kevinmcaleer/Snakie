import * as Blockly from 'blockly/core'
import { explainBlock, type BlockExplanation } from './explain'
import type { Dialect } from '../../../../shared/dialect'
import './block-doctor.css'

/**
 * THE *WHAT BLOCK IS THIS?* DROP ZONE (#1245).
 * =============================================================================
 *
 * A patch of the canvas a learner can DROP A BLOCK ON to be told what it is:
 * its shape, its drawer, the part or plugin or module it came from, the library
 * it imports, the pin it claims, the Python it writes, and the help article
 * that explains it. Aimed squarely at a program somebody else wrote — a worked
 * example, a classmate's file, a `.py` the converter turned into blocks — where
 * every other affordance assumes you already know what you are looking at.
 *
 * WHY A DROP TARGET RATHER THAN A MENU ITEM. Right-click ▸ Help exists and is
 * excellent for the block whose name you already know to look up; it is also
 * invisible, and a learner who does not know what a block IS does not know that
 * this one has an article. Dragging is the verb this whole editor is built on,
 * so the question gets asked in the only gesture the learner already has.
 *
 * NOTHING IS MOVED AND NOTHING IS DELETED. `shouldPreventMove` returns true, so
 * the dropped block springs back to exactly where it was: asking what a block
 * is must never be a way to take somebody's program apart. That is also why the
 * zone sits bottom-LEFT — the trashcan is bottom-right, and a target that eats
 * blocks should not share an edge with one that explains them.
 *
 * PLAIN DOM, NOT REACT. It lives inside Blockly's injection div, so that it
 * scrolls, resizes and disappears with the canvas rather than with a React
 * subtree that knows nothing about either; the facts it shows are
 * `explain.ts`'s and it invents none of its own.
 */

export interface BlockDoctorOptions {
  /** The runtime the Python preview should be generated for. */
  dialect?: () => Dialect
  /** Open the in-app help article for the block being explained. */
  onHelp?: (articleId: string) => void
}

/** Install the zone on `ws`. Returns a disposer for the canvas's cleanup. */
export function installBlockDoctor(
  ws: Blockly.WorkspaceSvg,
  options: BlockDoctorOptions = {}
): () => void {
  const injection = ws.getInjectionDiv()
  if (!injection) return () => {}

  const root = document.createElement('div')
  root.className = 'block-doctor block-doctor--idle'
  root.dataset.testid = 'block-doctor'
  injection.appendChild(root)
  renderIdle(root)

  // CLEAR OF THE SHELF. The zone is positioned against the injection div, whose
  // left edge is behind the toolbox — so at a plain `left: 12px` half of it sits
  // under the category column and the invitation reads "…s this? Drop one
  // here.". The toolbox's width is the offset, and it is asked for again
  // whenever the canvas is resized because a narrow window narrows the shelf.
  const place = (): void => {
    const shelf = ws.getToolbox()?.getWidth() ?? 0
    root.style.left = `${shelf + 12}px`
  }
  place()
  // Guarded: `ResizeObserver` is a browser API and this module is unit-tested in
  // jsdom, which has none. Without it the zone is placed once, correctly, and
  // only a resize could move the shelf out from under it.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
  observer?.observe(injection)

  const target = new BlockDoctorTarget(root, () => {
    // Anything dropped here is answered, even a block that cannot generate: a
    // learner asking about the block in their hand is owed the same answer
    // wherever it came from.
  })
  target.onDropped = (block) => {
    const explanation = explainBlock(block, options.dialect?.() ?? 'micropython')
    renderExplanation(root, explanation, options.onHelp)
  }

  ws.getComponentManager().addComponent({
    component: target,
    weight: 3,
    capabilities: [Blockly.ComponentManager.Capability.DRAG_TARGET]
  })

  return () => {
    observer?.disconnect()
    try {
      ws.getComponentManager().removeComponent(target.id)
    } catch {
      // A workspace already disposed has taken its component manager with it,
      // which is a cleanup that has nothing left to do rather than an error.
    }
    root.remove()
  }
}

/**
 * The Blockly half: a drag target that keeps what it is given.
 *
 * `getClientRect` is in VIEWPORT coordinates — the same units Blockly's own
 * trashcan reports, and the reason this can be read straight off the DOM
 * element rather than being reconstructed from workspace metrics.
 */
class BlockDoctorTarget extends Blockly.DragTarget {
  onDropped: ((block: Blockly.Block) => void) | null = null

  constructor(
    private readonly element: HTMLElement,
    private readonly onIgnored: () => void
  ) {
    super()
    this.id = 'snakieBlockDoctor'
  }

  override getClientRect(): Blockly.utils.Rect | null {
    const box = this.element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return null
    return new Blockly.utils.Rect(box.top, box.bottom, box.left, box.right)
  }

  override onDragEnter(): void {
    this.element.classList.add('block-doctor--over')
  }

  override onDragExit(): void {
    this.element.classList.remove('block-doctor--over')
  }

  override onDrop(dragElement: Blockly.IDraggable): void {
    this.element.classList.remove('block-doctor--over')
    // A BLOCK, and not the other thing Blockly drags — a comment bubble has no
    // type, no category and no Python, so the zone keeps its invitation up
    // rather than answering a question nobody asked.
    if (dragElement instanceof Blockly.Block) this.onDropped?.(dragElement)
    else this.onIgnored()
  }

  /**
   * The block goes home.
   *
   * The whole contract of this feature in one method: a question about a block
   * leaves the program exactly as it was.
   */
  override shouldPreventMove(): boolean {
    return true
  }
}

/** The zone before anything has been asked of it — an invitation, not a panel. */
export function renderIdle(root: HTMLElement): void {
  root.className = 'block-doctor block-doctor--idle'
  root.replaceChildren()
  const label = document.createElement('div')
  label.className = 'block-doctor__invite'
  label.innerHTML = '<span class="block-doctor__mark" aria-hidden="true">?</span>'
  const text = document.createElement('span')
  text.textContent = 'What block is this? Drop one here.'
  label.appendChild(text)
  root.appendChild(label)
}

/**
 * The answer, rendered.
 *
 * Ordered the way the question is asked: what it is called, what shape it is,
 * where it came from, what it needs, and only then the Python — a learner who
 * wanted the code would have read the mirror.
 */
export function renderExplanation(
  root: HTMLElement,
  ex: BlockExplanation,
  onHelp?: (articleId: string) => void
): void {
  root.className = 'block-doctor block-doctor--open'
  root.replaceChildren()

  const head = document.createElement('div')
  head.className = 'block-doctor__head'
  const title = document.createElement('h2')
  title.className = 'block-doctor__title'
  title.textContent = ex.title
  head.appendChild(title)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'block-doctor__close'
  close.title = 'Close'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '×'
  close.addEventListener('click', () => renderIdle(root))
  head.appendChild(close)
  root.appendChild(head)

  const body = document.createElement('div')
  body.className = 'block-doctor__body'
  root.appendChild(body)

  if (ex.unknown) {
    body.appendChild(
      note(
        `This version of Snakie has no description for “${ex.type}” — it probably comes from a part, plugin or Snakie newer than this one.`
      )
    )
    return
  }

  const chips = document.createElement('div')
  chips.className = 'block-doctor__chips'
  if (ex.category) chips.appendChild(chip(ex.category.name, 'block-doctor__chip--category'))
  chips.appendChild(chip(shapeWord(ex.shape)))
  if (ex.level === 'advanced') chips.appendChild(chip('Advanced'))
  if (ex.runtimes !== 'both') chips.appendChild(chip(runtimeWord(ex.runtimes)))
  body.appendChild(chips)

  if (ex.description) body.appendChild(note(ex.description))
  body.appendChild(note(ex.shapeLabel))

  body.appendChild(row('Comes from', ex.origin.label))
  if (ex.origin.part) {
    body.appendChild(row('Part', `${ex.origin.part.partId} (${ex.origin.part.libraryId})`))
  }
  if (ex.instrument) body.appendChild(row('Draws into', `the ${ex.instrument} instrument`))
  if (ex.libraries.length > 0) body.appendChild(row('Imports', ex.libraries.join(', ')))
  if (ex.call) body.appendChild(row('Stands for', ex.call, true))
  if (ex.pin) {
    const needs = ex.pin.needs ? `, and the pin must be able to ${ex.pin.needs}` : ''
    const way = ex.pin.direction ? ` (${ex.pin.direction === 'in' ? 'reads it' : 'drives it'})` : ''
    body.appendChild(row('Uses a pin', `to ${ex.pin.role}${way}${needs}`))
  }

  if (ex.fields.length > 0) {
    body.appendChild(
      row('Settings', ex.fields.map((f) => `${humanise(f.name)}: ${f.value}`).join(' · '))
    )
  }
  if (ex.sockets.length > 0) {
    body.appendChild(
      row(
        'Sockets',
        ex.sockets
          .map((s) => `${humanise(s.name)} — ${s.filled ? `holds ${s.holds}` : 'empty'}`)
          .join(' · ')
      )
    )
  }

  if (ex.python) {
    const label = document.createElement('div')
    label.className = 'block-doctor__label'
    label.textContent = 'The Python it writes'
    body.appendChild(label)
    const code = document.createElement('pre')
    code.className = 'block-doctor__code'
    code.textContent = ex.python
    body.appendChild(code)
  }

  const type = document.createElement('div')
  type.className = 'block-doctor__type'
  type.textContent = ex.type
  body.appendChild(type)

  if (ex.help && onHelp) {
    const help = document.createElement('button')
    help.type = 'button'
    help.className = 'block-doctor__help'
    help.textContent = 'Read more about this'
    const article = ex.help
    help.addEventListener('click', () => onHelp(article))
    body.appendChild(help)
  }
}

function chip(text: string, extra?: string): HTMLElement {
  const el = document.createElement('span')
  el.className = extra ? `block-doctor__chip ${extra}` : 'block-doctor__chip'
  el.textContent = text
  return el
}

function note(text: string): HTMLElement {
  const el = document.createElement('p')
  el.className = 'block-doctor__note'
  el.textContent = text
  return el
}

function row(label: string, value: string, mono = false): HTMLElement {
  const el = document.createElement('div')
  el.className = 'block-doctor__row'
  const key = document.createElement('span')
  key.className = 'block-doctor__key'
  key.textContent = label
  const val = document.createElement('span')
  val.className = mono ? 'block-doctor__value block-doctor__value--mono' : 'block-doctor__value'
  val.textContent = value
  el.append(key, val)
  return el
}

function shapeWord(shape: BlockExplanation['shape']): string {
  return { value: 'Value', statement: 'Statement', hat: 'Starting block', standalone: 'Standalone' }[
    shape
  ]
}

function runtimeWord(scope: BlockExplanation['runtimes']): string {
  return scope === 'micropython' ? 'MicroPython only' : 'CircuitPython only'
}

/** `SECONDS` → `seconds`, `PIN` → `pin`: a field name a learner can read. */
export function humanise(name: string): string {
  const words = name.toLowerCase().replace(/[_-]+/g, ' ').trim()
  return words === '' ? name : words
}
