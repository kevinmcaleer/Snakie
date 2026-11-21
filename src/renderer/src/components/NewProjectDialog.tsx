import { useEffect, useRef, useState, type JSX } from 'react'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { showStatus } from '../lib/status-bar'
import { reporter } from '../lib/report-error'
import { DEMO_ENTRY_FILE, DEMO_FILES, joinPath } from '../lib/demo-project'
import { blankRobot, type RobotDefinition } from '../../../shared/robot'
import {
  displayPath,
  folderName,
  planProject,
  projectSlug,
  type ProjectTemplate
} from '../lib/project-model'

/** `new` starts an empty project; `save` turns the unsaved scratch work into one. */
export type NewProjectMode = 'new' | 'save'

type Template = ProjectTemplate | 'demo'

/** Where the last project was created, so the next one goes beside it. */
const HOME_KEY = 'snakie.projectsHome'

function readHome(): string | null {
  try {
    return window.localStorage.getItem(HOME_KEY)
  } catch {
    return null
  }
}
function writeHome(dir: string): void {
  try {
    window.localStorage.setItem(HOME_KEY, dir)
  } catch {
    /* a convenience only */
  }
}

/** The folder a path sits in. */
function parentOf(path: string): string | null {
  const clean = path.replace(/[/\\]+$/, '')
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return i > 0 ? clean.slice(0, i) : null
}

const TEMPLATES: { id: Template; label: string; blurb: string }[] = [
  { id: 'code', label: 'Just code', blurb: 'A main.py to start from' },
  { id: 'robot', label: 'Robot', blurb: 'Code, wiring and a 3D model, linked together' },
  { id: 'demo', label: 'Servo arm demo', blurb: 'A working robot to explore' }
]

/**
 * NEW PROJECT — name it, choose where it lives, choose what it starts with.
 *
 * Writes a real folder (never a hidden one), shows the files it will create
 * before it creates them, and opens it. "Save as project" is the same dialog
 * carrying the unsaved scratch wiring (and any untitled code tabs) into the new
 * folder, then clearing the scratch so it doesn't come back next time.
 */
export function NewProjectDialog({
  mode,
  scratch,
  onClose
}: {
  mode: NewProjectMode
  scratch: RobotDefinition | null
  onClose: () => void
}): JSX.Element {
  const { currentFolder, openFiles, openFile, openFolderPath, saveBufferTo } = useWorkspace()
  const { switchWorkspace } = useWorkspaceLayout()
  const [name, setName] = useState(mode === 'save' ? scratch?.name?.trim() || 'My robot' : '')
  const [template, setTemplate] = useState<Template>(
    mode === 'save' ? (scratch?.robot?.urdf ? 'robot' : 'code') : 'robot'
  )
  const [home, setHome] = useState<string | null>(
    () => readHome() ?? (currentFolder ? parentOf(currentFolder) : null)
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const slug = projectSlug(name) || 'my-robot'
  const untitled = openFiles.filter((f) => f.source === 'local' && !f.path)
  const choices = mode === 'save' ? TEMPLATES.filter((t) => t.id !== 'demo') : TEMPLATES
  const preview = previewTree(slug, template, mode === 'save' ? untitled.map((f) => f.name) : [])

  const chooseHome = async (): Promise<string | null> => {
    const picked = await window.api.fs.openFolderDialog().catch(() => null)
    if (picked) {
      setHome(picked)
      setError(null)
    }
    return picked
  }

  const create = async (): Promise<void> => {
    if (busy) return
    setError(null)
    // No place chosen yet: ask now. This click is the gesture the web picker needs.
    const parent = home ?? (await chooseHome())
    if (!parent) {
      setError('Choose where to save the project first.')
      return
    }
    setBusy(true)
    try {
      const dir = joinPath(parent, slug)
      const existing = await window.api.fs.readDir(dir).catch(() => null)
      if (existing && existing.length > 0) {
        setError(
          `There's already a folder called "${slug}" in ${displayPath(parent)}. Pick another name, or open that project instead.`
        )
        return
      }
      await window.api.fs.mkdir(dir)
      let entry: string | null
      let land: 'code' | 'board' = 'code'
      if (template === 'demo') {
        for (const [file, content] of Object.entries(DEMO_FILES)) {
          await window.api.fs.writeFile(joinPath(dir, file), content)
        }
        entry = DEMO_ENTRY_FILE
        land = 'board' // the wiring is what the demo is there to show
      } else {
        const plan = planProject(name, template, mode === 'save' ? scratch : null)
        const codeDir = template === 'robot' ? 'code' : ''
        const keep = mode === 'save' ? untitled : []
        // Untitled tabs become the project's code; the starter file is only
        // written when there is nothing of the user's to put there.
        const files = keep.length ? plan.files.filter((f) => f.path !== plan.entry) : plan.files
        for (const f of files) {
          const sub = parentOf(f.path)
          if (sub) await window.api.fs.mkdir(joinPath(dir, sub))
          await window.api.fs.writeFile(joinPath(dir, f.path), f.content)
        }
        if (codeDir) await window.api.fs.mkdir(joinPath(dir, codeDir))
        const saved = await window.api.robot.save(dir, plan.robot)
        if (!saved.ok) throw new Error(saved.error || "couldn't write robot.yml")
        entry = plan.entry
        for (const f of keep) {
          await saveBufferTo(f.id, joinPath(codeDir ? joinPath(dir, codeDir) : dir, f.name))
        }
        if (keep.length) entry = null // already open, now saved in the project
        if (mode === 'save') await window.api.robot.save(undefined, blankRobot())
      }
      writeHome(parent)
      openFolderPath(dir)
      if (entry) await openFile('local', joinPath(dir, entry)).catch(() => undefined)
      switchWorkspace(land)
      showStatus(
        mode === 'save'
          ? `Saved as ${folderName(dir)} in ${displayPath(parent)}`
          : `Created ${folderName(dir)} in ${displayPath(parent)}`
      )
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Couldn't create the project: ${msg}`)
      reporter('new project')(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="newproj-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <form
        className="newproj"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newproj-title"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose()
        }}
      >
        <h2 id="newproj-title" className="newproj__title">
          {mode === 'save' ? 'Save as project' : 'New project'}
        </h2>
        {mode === 'save' && (
          <p className="newproj__lede">
            Your board, parts and wiring
            {untitled.length ? ` and ${untitled.length === 1 ? 'your untitled file' : `${untitled.length} untitled files`}` : ''} go
            into a new project folder.
          </p>
        )}
        <label className="newproj__label" htmlFor="newproj-name">
          Name
        </label>
        <input
          id="newproj-name"
          ref={inputRef}
          className="newproj__input"
          value={name}
          placeholder="Robot dog"
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <span className="newproj__label">Save in</span>
        <div className="newproj__where">
          <span className="newproj__path">{home ? displayPath(home) : 'Not chosen yet'}</span>
          <button type="button" className="newproj__change" onClick={() => void chooseHome()}>
            {home ? 'Change…' : 'Choose…'}
          </button>
        </div>
        <span className="newproj__label">Start with</span>
        <div className="newproj__templates" role="radiogroup" aria-label="Start with">
          {choices.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={template === t.id}
              className={`newproj__tpl${template === t.id ? ' newproj__tpl--on' : ''}`}
              onClick={() => setTemplate(t.id)}
            >
              <b>{t.label}</b>
              <small>{t.blurb}</small>
            </button>
          ))}
        </div>
        <pre className="newproj__tree" aria-label="Files this creates">
          {preview}
        </pre>
        {error && <p className="newproj__error">{error}</p>}
        <div className="newproj__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" aria-busy={busy || undefined}>
            {busy ? 'Creating…' : mode === 'save' ? 'Save project' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** The folder tree a template writes, for the dialog's preview. */
export function previewTree(slug: string, template: Template, untitled: string[] = []): string {
  if (template === 'demo') {
    return `${slug}/\n├── robot.yml     board, wiring, model link\n├── arm.urdf\n└── ${DEMO_ENTRY_FILE}`
  }
  if (template === 'code') {
    const code = untitled.length ? untitled : ['main.py']
    const lines = ['robot.yml     board and wiring', ...code]
    return `${slug}/\n` + lines.map((l, i) => `${i === lines.length - 1 ? '└──' : '├──'} ${l}`).join('\n')
  }
  const code = untitled.length ? untitled.map((n) => `code/${n}`) : ['code/main.py']
  const lines = ['robot.yml     board, wiring, model link', ...code, 'urdf/robot.urdf', 'stl/          print files']
  return `${slug}/\n` + lines.map((l, i) => `${i === lines.length - 1 ? '└──' : '├──'} ${l}`).join('\n')
}
