import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useWorkspace, readRecentFolders, FILE_SAVED_EVENT } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { showStatus } from '../lib/status-bar'
import { reporter } from '../lib/report-error'
import { joinPath } from '../lib/demo-project'
import { IS_WEB } from '../lib/env'
import { blankRobot, type RobotDefinition } from '../../../shared/robot'
import {
  displayPath,
  electronicsLine,
  filesLine,
  folderName,
  scratchHasWork,
  summariseProject,
  type ProjectSummary
} from '../lib/project-model'
import { NewProjectDialog, type NewProjectMode } from './NewProjectDialog'
import { ShareProjectDialog } from './ShareProjectDialog'
import './ProjectSwitcher.css'

/** Window events the app menu (File ▸ New Project… / Close Project) raises. */
export const NEW_PROJECT_EVENT = 'snakie:new-project'
export const CLOSE_PROJECT_EVENT = 'snakie:close-project'
/** Opens the Share sheet (also raised by Electronics' Export menu). */
export const SHARE_PROJECT_EVENT = 'snakie:share-project'

type FsExtras = {
  openRecent?: (path: string) => Promise<string | null>
  showInFolder?: (path: string) => Promise<void>
}
const fsx = (): FsExtras => {
  const fs = window.api.fs as unknown as FsExtras
  // The web build has no file manager to show a folder in.
  return IS_WEB ? { openRecent: fs.openRecent } : fs
}

/** List a folder, or nothing when it isn't there. */
async function list(path: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    return await window.api.fs.readDir(path)
  } catch {
    return []
  }
}

/**
 * PROJECT SWITCHER — the project's name in the top bar, on every workspace.
 * =============================================================================
 *
 * Answers the three questions Snakie never did: which project is this (and is
 * it saved), what is in it, and how do I start a new one or open another. The
 * menu lists what belongs to the project — the code, the Electronics wiring
 * (held in `robot.yml`), the Build model `robot.yml` links, and the print files
 * — each a jump to its workspace; then New, Open, Recent and Close.
 *
 * With no folder open, Electronics and Build keep working on a scratch
 * `robot.yml` that is NOT in any folder. The chip turns gold and says "not
 * saved", and the menu leads to Save as project or Start fresh, instead of the
 * scratch work silently reappearing as if it were a project.
 */
export function ProjectSwitcher(): JSX.Element {
  const { currentFolder, openFiles, openFile, openFolder, openFolderPath, closeFolder } =
    useWorkspace()
  const { switchWorkspace } = useWorkspaceLayout()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<NewProjectMode | null>(null)
  const [sharing, setSharing] = useState(false)
  const [summary, setSummary] = useState<ProjectSummary | null>(null)
  const [scratch, setScratch] = useState<RobotDefinition | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [nonce, setNonce] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // Re-read whenever robot.yml or a file is saved, so the chip's name and the
  // "In this project" rows follow edits made in any workspace.
  useEffect(() => window.api.robot.onChanged(() => setNonce((n) => n + 1)), [])
  useEffect(() => {
    const bump = (): void => setNonce((n) => n + 1)
    window.addEventListener(FILE_SAVED_EVENT, bump)
    return () => window.removeEventListener(FILE_SAVED_EVENT, bump)
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      if (!currentFolder) {
        const def = await window.api.robot.load().catch(() => null)
        if (!live) return
        setSummary(null)
        setScratch(def)
        return
      }
      const dir = currentFolder.replace(/[/\\]+$/, '')
      const [robot, root, code, stl] = await Promise.all([
        window.api.robot.load(dir).catch(() => null),
        list(dir),
        list(joinPath(dir, 'code')),
        list(joinPath(dir, 'stl'))
      ])
      if (!live) return
      setScratch(null)
      setSummary(summariseProject({ folder: dir, robot, root, code, stl }))
    })()
    return () => {
      live = false
    }
  }, [currentFolder, nonce, open])

  useEffect(() => {
    if (open) setRecent(readRecentFolders().filter((f) => f !== currentFolder).slice(0, 5))
  }, [open, currentFolder])

  // Close on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unsaved = !currentFolder && scratchHasWork(scratch)

  // ---- actions ----------------------------------------------------------

  const closeProject = useCallback((): void => {
    if (!currentFolder) {
      showStatus('No project is open. Choose New Project… or Open Folder… to start one.')
      return
    }
    const root = currentFolder.replace(/[/\\]+$/, '')
    const dirty = openFiles.filter(
      (f) => f.source === 'local' && f.dirty && f.path.startsWith(root)
    )
    if (
      dirty.length &&
      !window.confirm(
        `${filesLine(dirty.map((f) => f.name), 3)} ${dirty.length === 1 ? 'has' : 'have'} unsaved changes.\n\n` +
          'Close the project anyway? Those changes will be lost.'
      )
    ) {
      return
    }
    closeFolder()
    setOpen(false)
    showStatus(`Closed ${summary?.name ?? folderName(root)}. It's still in ${displayPath(root)}.`)
  }, [currentFolder, openFiles, closeFolder, summary])

  const startFresh = useCallback(async (): Promise<void> => {
    if (
      !window.confirm(
        'Start fresh?\n\nThis clears the board, parts and wiring you haven’t saved to a project. ' +
          'To keep them, choose Save as project instead.'
      )
    ) {
      return
    }
    await window.api.robot.save(undefined, blankRobot())
    setOpen(false)
    setNonce((n) => n + 1)
    showStatus('Cleared. You have a fresh start.')
  }, [])

  const openProject = useCallback(async (): Promise<void> => {
    setOpen(false)
    await openFolder().catch(reporter('open project', { notify: "Couldn't open that folder." }))
  }, [openFolder])

  const openRecentProject = useCallback(
    async (path: string): Promise<void> => {
      setOpen(false)
      const opener = fsx().openRecent
      const got = opener ? await opener(path).catch(() => null) : path
      if (got) {
        openFolderPath(got)
        showStatus(`Opened ${folderName(got)}`)
      } else {
        showStatus(
          `Couldn't open ${folderName(path)}. It may have moved. Choose Open project… to find it.`,
          { priority: 3 }
        )
      }
    },
    [openFolderPath]
  )

  const go = useCallback(
    async (where: 'code' | 'board' | 'robot' | 'print'): Promise<void> => {
      setOpen(false)
      const dir = currentFolder?.replace(/[/\\]+$/, '')
      if (where === 'code') {
        switchWorkspace('code')
        const first = summary?.code[0]
        if (dir && first) await openFile('local', joinPath(dir, first)).catch(() => undefined)
        return
      }
      if (where === 'board' || where === 'robot') {
        switchWorkspace(where)
        return
      }
      // Print files: the folder they live in. Desktop shows it in Finder /
      // Explorer; the web has no such thing, so show the Files panel instead.
      if (!dir) return
      const stl = joinPath(dir, 'stl')
      const show = fsx().showInFolder
      if (show) {
        await window.api.fs.mkdir(stl).catch(() => undefined)
        await show(stl).catch(() => showStatus(`Your print files go in ${displayPath(stl)}`))
      } else {
        switchWorkspace('code')
        showStatus('Print files go in the stl folder, in the Files panel.')
      }
    },
    [currentFolder, summary, switchWorkspace, openFile]
  )

  // The app menu's File ▸ New Project… / Close Project.
  useEffect(() => {
    const onNew = (): void => setDialog(currentFolder || !unsaved ? 'new' : 'save')
    const onClose = (): void => closeProject()
    const onShare = (): void => setSharing(true)
    window.addEventListener(NEW_PROJECT_EVENT, onNew)
    window.addEventListener(CLOSE_PROJECT_EVENT, onClose)
    window.addEventListener(SHARE_PROJECT_EVENT, onShare)
    return () => {
      window.removeEventListener(NEW_PROJECT_EVENT, onNew)
      window.removeEventListener(CLOSE_PROJECT_EVENT, onClose)
      window.removeEventListener(SHARE_PROJECT_EVENT, onShare)
    }
  }, [currentFolder, unsaved, closeProject])

  // ---- render ------------------------------------------------------------

  const name = currentFolder
    ? (summary?.name ?? folderName(currentFolder))
    : unsaved
      ? scratch?.name?.trim() || 'Untitled robot'
      : 'No project open'
  const chipTitle = currentFolder
    ? `${name}, saved in ${displayPath(currentFolder)}. Click for what's in it, or to open another project.`
    : unsaved
      ? 'This work is not saved to a folder yet. Click to save it as a project.'
      : 'Click to start a new project or open one.'

  // Share sits first in a project's menu; with no project, after New and Open.
  const shareAction = (
    <Action
      glyph="⇪"
      label="Share project…"
      hint={currentFolder ? 'kevsrobots, BetterCAD, GitHub' : undefined}
      primary={!!currentFolder}
      onClick={() => {
        setOpen(false)
        setSharing(true)
      }}
    />
  )

  return (
    <div className="projsw" ref={rootRef}>
      <button
        type="button"
        className={`projsw__chip${unsaved ? ' projsw__chip--unsaved' : ''}${open ? ' projsw__chip--open' : ''}${!currentFolder && !unsaved ? ' projsw__chip--none' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={chipTitle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FolderGlyph />
        <span className="projsw__name">{name}</span>
        {unsaved && <span className="projsw__tag">not saved</span>}
        <span className="projsw__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="projsw__menu" role="menu" aria-label="Project">
          <span className="projsw__grab" aria-hidden="true" />
          {currentFolder ? (
            <>
              <div className="projsw__head">
                <strong>{name}</strong>
                <span className="projsw__path">{displayPath(currentFolder)}</span>
                {fsx().showInFolder && (
                  <button
                    type="button"
                    className="projsw__link"
                    onClick={() => {
                      setOpen(false)
                      void fsx()
                        .showInFolder?.(currentFolder)
                        .catch(reporter('show in folder', { notify: "Couldn't show the folder." }))
                    }}
                  >
                    Show in folder ↗
                  </button>
                )}
              </div>
              <div className="projsw__sub">In this project</div>
              <Row
                kind="code"
                label="Code"
                detail={summary?.code.length ? filesLine(summary.code) : 'No code yet'}
                onClick={() => void go('code')}
              />
              <Row
                kind="board"
                label="Electronics"
                detail={summary ? electronicsLine(summary) : '…'}
                note="in robot.yml"
                onClick={() => void go('board')}
              />
              <Row
                kind="robot"
                label="Build"
                detail={summary?.model ? summary.model : 'No robot model yet'}
                onClick={() => void go('robot')}
              />
              <Row
                kind="print"
                label="Print files"
                detail={
                  summary?.print.length
                    ? `${summary.print.length} file${summary.print.length === 1 ? '' : 's'}`
                    : 'None yet: export STLs into stl/'
                }
                onClick={() => void go('print')}
              />
            </>
          ) : (
            <div className="projsw__head">
              <strong>{name}</strong>
              <span className="projsw__note">
                {unsaved
                  ? 'Your Electronics and Build work is kept in Snakie until you save it. Save it as a project so you can find it, back it up and share it.'
                  : 'A project is a folder that keeps your code, wiring, 3D model and print files together.'}
              </span>
            </div>
          )}
          {currentFolder && <div className="projsw__sep" />}
          {currentFolder && shareAction}
          {unsaved && (
            <Action
              glyph="↓"
              label="Save as project…"
              primary
              onClick={() => {
                setOpen(false)
                setDialog('save')
              }}
            />
          )}
          <Action
            glyph="＋"
            label="New project…"
            primary={!currentFolder && !unsaved}
            onClick={() => {
              setOpen(false)
              setDialog('new')
            }}
          />
          <Action glyph="↗" label="Open project…" onClick={() => void openProject()} />
          {!currentFolder && shareAction}
          {unsaved && (
            <Action
              glyph="⟲"
              label="Start fresh"
              hint="clears the unsaved board and parts"
              onClick={() => void startFresh()}
            />
          )}
          {recent.length > 0 && (
            <>
              <div className="projsw__sub">Recent</div>
              {recent.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="menuitem"
                  className="projsw__recent"
                  title={displayPath(f)}
                  onClick={() => void openRecentProject(f)}
                >
                  <span>{folderName(f)}</span>
                  <span className="projsw__path">{displayPath(f)}</span>
                </button>
              ))}
            </>
          )}
          {currentFolder && (
            <>
              <div className="projsw__sep" />
              <Action glyph="✕" label="Close project" onClick={closeProject} />
            </>
          )}
        </div>
      )}

      {sharing && (
        <ShareProjectDialog
          folder={currentFolder}
          summary={summary}
          onClose={() => setSharing(false)}
          onSaveAsProject={() => setDialog(unsaved ? 'save' : 'new')}
        />
      )}

      {dialog && (
        <NewProjectDialog
          mode={dialog}
          scratch={dialog === 'save' ? scratch : null}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function Row({
  kind,
  label,
  detail,
  note,
  onClick
}: {
  kind: 'code' | 'board' | 'robot' | 'print'
  label: string
  detail: string
  note?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button type="button" role="menuitem" className="projsw__row" onClick={onClick}>
      <span className={`projsw__key projsw__key--${kind}`} aria-hidden="true" />
      <span className="projsw__rowtext">
        <span className="projsw__rowlabel">{label}</span>
        <span className="projsw__detail">
          {detail}
          {note && <span className="projsw__rownote"> · {note}</span>}
        </span>
      </span>
      <span className="projsw__go" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

function Action({
  glyph,
  label,
  hint,
  primary,
  onClick
}: {
  glyph: string
  label: string
  hint?: string
  primary?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className={`projsw__action${primary ? ' projsw__action--primary' : ''}`}
      onClick={onClick}
    >
      <span className="projsw__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span>
        {label}
        {hint && <span className="projsw__hint"> ({hint})</span>}
      </span>
    </button>
  )
}

function FolderGlyph(): JSX.Element {
  return (
    <svg className="projsw__icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 4.2c0-.7.5-1.2 1.2-1.2h3.2l1.5 1.6h5.9c.7 0 1.2.5 1.2 1.2v6.5c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
