import * as Blockly from 'blockly/core'
import type { RegistrableField } from 'blockly/core/field_registry'

/**
 * THE PYTHON FIELD (#1018, epic #1007).
 * =============================================================================
 *
 * The text box inside the escape-hatch blocks — and the issue's actual ask: that
 * it be **the best-autocompleted field in the app rather than the worst**.
 *
 * So its editor is MONACO, not an `<input>` — a real one-line code editor in
 * Blockly's widget div, with Python syntax highlighting and the app's own
 * MicroPython completions. Typing `sensor.` in the grey block offers the same
 * list as typing it in the editor next door, because it IS the same list.
 *
 * THIS MODULE DOES NOT IMPORT MONACO. It holds the field, the widget div, the
 * commit rules and the paste handling; the editor itself arrives through
 * {@link setCodeEditorFactory}, which `python-editor.ts` calls on import. Two
 * reasons, and the first is not cosmetic:
 *
 *  - the PALETTE has to stay importable in plain node, because the generator's
 *    golden-file suites build a headless workspace out of it — and Monaco
 *    touches `window` at module scope;
 *  - a learner who never opens a Python block never needs the editor.
 *
 * IT CAN ALWAYS FALL BACK. With no factory registered, or if one fails for any
 * reason, Blockly's own plain text editor opens instead. The one thing a field
 * in the *escape hatch* must never be is unusable — that would put the wall back
 * exactly where this issue removes it.
 */

/**
 * A code editor mounted into the field's widget div, seen from the field.
 *
 * Deliberately tiny: everything Blockly needs from the editor is its text, its
 * focus, and being told when the learner is finished. Keeping the surface this
 * small is what lets the field be tested, and used, with no editor at all.
 */
export interface CodeEditorHandle {
  /** What the learner has typed, right now. */
  getValue(): string
  /** Put the caret in it. */
  focus(): void
  /** Tear it down. Called exactly once, on every close path. */
  dispose(): void
}

/** How the field asks for an editor. Returns null when it cannot make one. */
export type CodeEditorFactory = (options: {
  /** The element to mount into, already sized. */
  host: HTMLElement
  /** The text to open on. */
  value: string
  /** The learner is finished — commit and close. */
  onCommit: () => void
  /** The learner pressed Escape — put the old text back and close. */
  onCancel: () => void
}) => CodeEditorHandle | null

let codeEditorFactory: CodeEditorFactory | null = null

/**
 * Install the editor these fields open. `python-editor.ts` calls this; a node
 * test does not, and gets Blockly's plain text editor instead.
 */
export function setCodeEditorFactory(factory: CodeEditorFactory | null): void {
  codeEditorFactory = factory
}

/** The JSON type name a block definition uses. */
export const FIELD_PYTHON_TYPE = 'field_snakie_python'

/** How wide the editor opens, in px, however narrow the block is. */
const MIN_EDITOR_WIDTH = 320
/** And how wide it is allowed to get. */
const MAX_EDITOR_WIDTH = 720

export class FieldPython extends Blockly.FieldTextInput {
  /** The widget div child holding the editor, while one is open. */
  private codeHost: HTMLDivElement | null = null
  private codeEditor: CodeEditorHandle | null = null
  /** The value the editor opened on, so Escape can put it back. */
  private valueOnOpen = ''
  /** Set by Escape, so the dispose below reverts instead of committing. */
  private cancelled = false
  /** The placeholder shown when the field is empty. */
  private readonly placeholder: string
  /**
   * The block type extra lines of a multi-line paste become (#1018).
   *
   * Set only on the statement block. A paste of three lines there becomes three
   * blocks, which is the shape the learner wanted; on a VALUE field there is no
   * such shape, so the lines are joined instead.
   */
  private readonly splitInto?: string

  constructor(value?: string, placeholder = 'your Python here', splitInto?: string) {
    super(value ?? '')
    this.placeholder = placeholder
    this.splitInto = splitInto
  }

  static override fromJson(options: Blockly.FieldTextInputFromJsonConfig): FieldPython {
    const { text, placeholder, splitInto } = options as unknown as {
      text?: string
      placeholder?: string
      splitInto?: string
    }
    return new FieldPython(text === undefined ? '' : String(text), placeholder, splitInto)
  }

  /**
   * Mono-spaced, like the mirror next door.
   *
   * The one visual decision that makes these "the grey blocks that look like
   * code" rather than grey blocks with words in them — and it costs a class on
   * one SVG element.
   */
  override initView(): void {
    super.initView()
    try {
      this.getTextElement().classList.add('snakie-python-code')
    } catch {
      /* no text element yet (a headless workspace) — nothing to style */
    }
  }

  /**
   * Accept ANYTHING, including text that does not parse.
   *
   * The whole point of an escape hatch is that it never refuses. A field
   * validator rejecting a half-typed line would delete what somebody was in the
   * middle of writing; `python-check.ts` puts a warning on the block instead,
   * which is a thing you can read and then finish.
   */
  protected override doClassValidation_(value?: string): string | null {
    return value === undefined || value === null ? '' : String(value)
  }

  /** Empty reads as a prompt rather than as a blank gap nobody knows to click. */
  override getText(): string {
    const value = String(this.getValue() ?? '')
    return value === '' ? this.placeholder : value
  }

  /** Open Monaco; fall back to Blockly's own editor if anything goes wrong. */
  protected override showEditor_(e?: Event, quietInput?: boolean): void {
    if (this.showCodeEditor()) return
    super.showEditor_(e, quietInput)
  }

  private showCodeEditor(): boolean {
    const block = this.getSourceBlock()
    const factory = codeEditorFactory
    if (!block || !factory) return false
    try {
      const workspace = (block.workspace ?? null) as Blockly.WorkspaceSvg | null
      Blockly.WidgetDiv.show(this, block.RTL, () => this.disposeCodeEditor(), workspace)
      const div = Blockly.WidgetDiv.getDiv()
      if (!div) return false

      this.valueOnOpen = String(this.getValue() ?? '')
      this.cancelled = false

      const host = document.createElement('div')
      host.className = 'blocks-python-field'
      const { width, height } = this.editorSize()
      host.style.width = `${width}px`
      host.style.height = `${height}px`
      div.appendChild(host)
      this.codeHost = host

      const editor = factory({
        host,
        value: this.valueOnOpen,
        onCommit: () => Blockly.WidgetDiv.hide(),
        onCancel: () => {
          this.cancelled = true
          Blockly.WidgetDiv.hide()
        }
      })
      if (!editor) throw new Error('no editor')
      this.codeEditor = editor
      editor.focus()
      this.positionEditor(width, height)
      return true
    } catch {
      // The editor could not mount. Put the widget div back the way we found it
      // so Blockly's own can use it, and say so by returning false.
      this.disposeCodeEditor()
      if (Blockly.WidgetDiv.isVisible()) Blockly.WidgetDiv.hide()
      return false
    }
  }

  /** How big to open, from the field's own width and a sane floor and ceiling. */
  private editorSize(): { width: number; height: number } {
    let fieldWidth = MIN_EDITOR_WIDTH
    try {
      fieldWidth = this.getScaledBBox().right - this.getScaledBBox().left
    } catch {
      /* no rendered field (a headless test) — the floor is the answer */
    }
    return {
      width: Math.round(Math.min(MAX_EDITOR_WIDTH, Math.max(MIN_EDITOR_WIDTH, fieldWidth + 40))),
      height: 30
    }
  }

  /**
   * Put the editor over the field, clamped to the window.
   *
   * Deliberately not Blockly's `positionWithAnchor`, which is marked internal
   * and places the widget BELOW the anchor: an editor that replaces the field
   * in place is the illusion this field is selling, and one that drops down
   * somewhere else breaks it.
   */
  private positionEditor(width: number, height: number): void {
    const div = Blockly.WidgetDiv.getDiv()
    if (!div) return
    let box: Blockly.utils.Rect | null = null
    try {
      box = this.getScaledBBox()
    } catch {
      box = null
    }
    const left = box ? box.left : Math.max(0, (window.innerWidth - width) / 2)
    const top = box ? box.top : Math.max(0, (window.innerHeight - height) / 2)
    div.style.left = `${Math.round(Math.min(left, Math.max(0, window.innerWidth - width - 8)))}px`
    div.style.top = `${Math.round(Math.min(top, Math.max(0, window.innerHeight - height - 8)))}px`
    div.style.width = `${width}px`
    div.style.height = `${height}px`
  }

  /** Commit (or revert) and tear the editor down. Runs on every close path. */
  private disposeCodeEditor(): void {
    const editor = this.codeEditor
    if (editor) {
      const raw = editor.getValue()
      this.codeEditor = null
      editor.dispose()
      if (this.cancelled) this.setValue(this.valueOnOpen)
      else this.commit(raw)
    }
    this.codeHost?.remove()
    this.codeHost = null
    this.cancelled = false
  }

  /**
   * Take what the editor holds and put it on the block — as ONE line, or as a
   * STACK when somebody pasted several.
   *
   * Pasting a snippet off the internet is the single likeliest thing to happen
   * to this field, and the two obvious answers are both bad: truncating to the
   * first line loses their code silently, and refusing the paste sends them
   * away to a text editor. Splitting gives them exactly what they pasted, in
   * the shape the rest of the canvas is already in — and each line then gets
   * its own warning badge, its own highlight in the mirror, and its own place
   * for a traceback to land.
   */
  private commit(raw: string): void {
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    const block = this.getSourceBlock()
    if (!this.splitInto || lines.length < 2 || !block) {
      // Joined rather than truncated, so nothing disappears without trace. On
      // one line `for i in x: go()` is even legal Python.
      this.setValue(lines.join(' '))
      return
    }
    this.setValue(lines[0])
    appendStatements(block, this.splitInto, lines.slice(1))
  }
}

/**
 * Insert one new block per extra line, in order, after `after`.
 *
 * Grouped as ONE undo step: a learner who pastes six lines and presses ⌘Z
 * expects the paste to go, not one line of it.
 */
function appendStatements(after: Blockly.Block, type: string, lines: readonly string[]): void {
  const workspace = after.workspace
  if (!workspace) return
  const group = Blockly.Events.getGroup() || Blockly.utils.idGenerator.genUid()
  const hadGroup = Boolean(Blockly.Events.getGroup())
  if (!hadGroup) Blockly.Events.setGroup(group)
  try {
    let previous = after
    for (const line of lines) {
      const next = workspace.newBlock(type)
      next.setFieldValue(line, 'CODE')
      if ('initSvg' in next && typeof next.initSvg === 'function') {
        ;(next as Blockly.BlockSvg).initSvg()
        ;(next as Blockly.BlockSvg).render()
      }
      // Splice in rather than append: whatever was below the pasted-into block
      // stays below the whole stack.
      const tail = previous.nextConnection?.targetConnection ?? null
      previous.nextConnection?.connect(next.previousConnection!)
      if (tail && next.nextConnection) next.nextConnection.connect(tail)
      previous = next
    }
  } catch {
    // A connection Blockly refuses (a value block, a block already full) is not
    // worth losing the first line over — the text is already on the field.
  } finally {
    if (!hadGroup) Blockly.Events.setGroup(false)
  }
}

/**
 * Register the field type. Idempotent, like the other field installers — the
 * palette module calls it before any block that names the type is defined,
 * because a JSON definition naming an unknown field type throws while the block
 * is built.
 */
export function installPythonField(): void {
  if (Blockly.registry.hasItem(Blockly.registry.Type.FIELD, FIELD_PYTHON_TYPE)) return
  Blockly.fieldRegistry.register(FIELD_PYTHON_TYPE, FieldPython as unknown as RegistrableField)
}
