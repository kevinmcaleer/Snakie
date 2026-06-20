import { useCallback, useEffect, useRef, useState } from 'react'
import { ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTheme } from '../hooks/useTheme'
import { Toolbar } from './Toolbar'
import { ActivityBar, ActivityView } from './ActivityBar'
import { PanelHeader } from './PanelHeader'
import { FilePanel } from './FilePanel'
import { GitPanel } from './GitPanel'
import { PackagesPanel } from './PackagesPanel'
import { PluginsPanel } from './PluginsPanel'
import { InspectPanel } from './InspectPanel'
import { HelpPanel } from './HelpPanel'
import { EditorArea } from './EditorArea'
import { InstrumentHost, type OpenInstrument } from './InstrumentHost'
import { ShellPanel } from './ShellPanel'
import { RightPanel } from './RightPanel'
import { StatusBar } from './StatusBar'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import { OPEN_SETTINGS_EVENT } from './settingsBus'
import { useWorkspace } from '../store/workspace'

/**
 * Wrap a panel that lacks its own region chrome in a scrollable region.
 *
 * The label bar (`PanelHeader`) is opt-out: the activity bar already names the
 * active view, so redundant title bars are dropped for most views (issue #79)
 * by passing `showHeader={false}`. Views that still want a label (e.g. Help)
 * leave the default on.
 */
function LeftRegion({
  title,
  showHeader = true,
  children
}: {
  title: string
  showHeader?: boolean
  children: JSX.Element
}): JSX.Element {
  return (
    <section className="region" aria-label={title}>
      {showHeader && <PanelHeader title={title} />}
      <div className="region__body">{children}</div>
    </section>
  )
}

/**
 * Map each activity-bar view id to the component shown in the left sidebar.
 * FilePanel and InspectPanel bring their own region; the others are wrapped
 * here so every view gets a consistent scrollable container (previously
 * provided by the right-pane tab host). The redundant title bars are omitted
 * per issue #79 — the activity bar already labels the active view — except for
 * Help, which keeps its label.
 */
function LeftView({ view }: { view: ActivityView }): JSX.Element {
  switch (view) {
    case 'source-control':
      return (
        <LeftRegion title="Source Control" showHeader={false}>
          <GitPanel />
        </LeftRegion>
      )
    case 'packages':
      return (
        <LeftRegion title="Packages" showHeader={false}>
          <PackagesPanel />
        </LeftRegion>
      )
    case 'plugins':
      return (
        <LeftRegion title="Plugins" showHeader={false}>
          <PluginsPanel />
        </LeftRegion>
      )
    case 'inspect':
      return <InspectPanel />
    case 'help':
      return (
        <LeftRegion title="Help">
          <HelpPanel />
        </LeftRegion>
      )
    case 'files':
    default:
      return <FilePanel />
  }
}

/**
 * AppShell — the structural base layout that every later feature plugs into.
 *
 * Regions:
 *   - Top toolbar (Run/Stop placeholders, connection status, theme toggle)
 *   - Left sidebar: FilePanel (collapsible)
 *   - Center: EditorArea + bottom ShellPanel (shell open by default)
 *   - Right pane: RightPanel (collapsed by default)
 *
 * Panel sizes are persisted by react-resizable-panels' `autoSaveId`
 * (localStorage). Collapsed flags are persisted separately so the toolbar
 * toggles and resize handles stay in sync across restarts.
 */
export function AppShell(): JSX.Element {
  const { theme, toggleTheme } = useTheme()

  // The active file feeds the floating Board View window. Reading it here lets
  // us stream every edit / theme change to that window over IPC so it updates
  // live. `boardOpened` tracks whether the window has been opened this session
  // (so we only stream while it's open); it resets when the user closes it.
  const { openFiles, activeId } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const [boardOpened, setBoardOpened] = useState(false)

  const boardSource = activeFile?.content ?? ''
  const boardFileName = activeFile?.name
  const boardIsPython = !!activeFile && /\.py$/i.test(activeFile.name)

  // Toggle the floating Board View window from the toolbar button: open (and
  // push the current file immediately so it isn't blank) if closed, or close it
  // if it's already open. `onClosed` resets `boardOpened` either way.
  const toggleBoard = useCallback((): void => {
    if (boardOpened) {
      window.api.board.close()
      return
    }
    setBoardOpened(true)
    window.api.board
      .open()
      .then(() =>
        window.api.board.update({
          source: boardSource,
          fileName: boardFileName,
          isPython: boardIsPython,
          theme
        })
      )
      .catch(() => undefined)
  }, [boardOpened, boardSource, boardFileName, boardIsPython, theme])

  // While the window is open, stream the active file / content / theme to it on
  // every change so it stays live.
  useEffect(() => {
    if (!boardOpened) return
    window.api.board.update({
      source: boardSource,
      fileName: boardFileName,
      isPython: boardIsPython,
      theme
    })
  }, [boardOpened, boardSource, boardFileName, boardIsPython, theme])

  // Reset the "opened" flag when the user closes the board window.
  useEffect(() => {
    const off = window.api.board.onClosed(() => setBoardOpened(false))
    return off
  }, [])

  // --- Instruments hosted in the MAIN window (#101 / #102) -------------------
  // The Oscilloscope + Multimeter now float over / dock beside the code editor
  // in THIS window. The board-view window's node launchers fire a cross-window
  // `instruments.open(...)` request (relayed by the main process); we receive it
  // here and add the instrument. `instrumentsVisible` (default true) is toggled
  // by the toolbar button — false hides the host (kept mounted, positions
  // survive). Opening an instrument also reveals the host.
  const [openInstruments, setOpenInstruments] = useState<OpenInstrument[]>([])
  const [instrumentsVisible, setInstrumentsVisible] = useState(true)

  useEffect(() => {
    const off = window.api.instruments.onOpen((payload) => {
      const { kind, variable } = payload
      setOpenInstruments((cur) =>
        cur.some((it) => it.kind === kind && it.variable === variable)
          ? cur
          : [...cur, { kind, variable }]
      )
      setInstrumentsVisible(true) // opening reveals the host
    })
    return off
  }, [])

  const toggleInstruments = useCallback((): void => {
    setInstrumentsVisible((v) => !v)
  }, [])

  // Persisted collapsed state. Shell is open by default (core REPL tool);
  // the right pane is collapsed by default to keep things uncluttered.
  const [filesCollapsed, setFilesCollapsed] = useLocalStorage('snakie.collapsed.files', false)
  const [shellCollapsed, setShellCollapsed] = useLocalStorage('snakie.collapsed.shell', false)
  const [rightCollapsed, setRightCollapsed] = useLocalStorage('snakie.collapsed.right', true)

  // Which view the left sidebar shows, driven by the ActivityBar.
  const [activityView, setActivityView] = useLocalStorage<ActivityView>(
    'snakie.activityView',
    'files'
  )

  // Settings dialog (issues #80/#81, tabbed in #83/#84) — opened from the
  // toolbar gear (Editor tab) or the chat's ⚙ (Chat tab, via settingsBus).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('editor')

  const openSettings = useCallback((tab: SettingsTab): void => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  // Let any component (e.g. the chat panel) deep-link a settings tab via a
  // window event, so we don't have to thread a callback through the tree.
  useEffect(() => {
    const handler = (e: Event): void => {
      const tab = (e as CustomEvent<SettingsTab>).detail ?? 'editor'
      openSettings(tab)
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, handler)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler)
  }, [openSettings])

  const filesRef = useRef<ImperativePanelHandle>(null)
  const shellRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)

  const toggle = (
    ref: React.RefObject<ImperativePanelHandle>,
    collapsed: boolean,
    setCollapsed: (v: boolean) => void
  ): void => {
    const panel = ref.current
    if (!panel) return
    if (collapsed) panel.expand()
    else panel.collapse()
    setCollapsed(!collapsed)
  }

  return (
    <div className="shell">
      <Toolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        filesCollapsed={filesCollapsed}
        onToggleFiles={() => toggle(filesRef, filesCollapsed, setFilesCollapsed)}
        shellCollapsed={shellCollapsed}
        onToggleShell={() => toggle(shellRef, shellCollapsed, setShellCollapsed)}
        rightCollapsed={rightCollapsed}
        onToggleRight={() => toggle(rightRef, rightCollapsed, setRightCollapsed)}
        onOpenSettings={() => openSettings('editor')}
        onOpenBoard={toggleBoard}
        onToggleInstruments={toggleInstruments}
        instrumentsVisible={instrumentsVisible}
        instrumentCount={openInstruments.length}
      />

      <div className="shell__body shell__main">
        <ActivityBar
          active={activityView}
          onSelect={(view) => {
            // Clicking the already-active view toggles the left panel collapse
            // (issue #86): collapse it when open, re-expand it when collapsed.
            if (view === activityView) {
              toggle(filesRef, filesCollapsed, setFilesCollapsed)
              return
            }
            // Switching to a different view selects it and reveals the sidebar
            // if it was collapsed.
            setActivityView(view)
            if (filesCollapsed) toggle(filesRef, true, setFilesCollapsed)
          }}
        />
        <PanelGroup
          direction="horizontal"
          autoSaveId="snakie.layout.horizontal"
          className="shell__panels"
        >
          <Panel
            ref={filesRef}
            order={1}
            collapsible
            collapsedSize={0}
            defaultSize={filesCollapsed ? 0 : 18}
            minSize={12}
            onCollapse={() => setFilesCollapsed(true)}
            onExpand={() => setFilesCollapsed(false)}
          >
            <LeftView view={activityView} />
          </Panel>

          <PanelResizeHandle className="resize-handle resize-handle--vertical" />

          <Panel order={2} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="snakie.layout.vertical">
              <Panel order={1} minSize={20}>
                <div className="shell__editor-region">
                  <EditorArea />
                  <InstrumentHost
                    source={boardSource}
                    isPython={boardIsPython}
                    visible={instrumentsVisible}
                    instruments={openInstruments}
                    onChange={setOpenInstruments}
                  />
                </div>
              </Panel>

              <PanelResizeHandle className="resize-handle resize-handle--horizontal" />

              <Panel
                ref={shellRef}
                order={2}
                collapsible
                collapsedSize={0}
                defaultSize={shellCollapsed ? 0 : 30}
                minSize={12}
                onCollapse={() => setShellCollapsed(true)}
                onExpand={() => setShellCollapsed(false)}
              >
                <ShellPanel chatOpen={!rightCollapsed} />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="resize-handle resize-handle--vertical" />

          <Panel
            ref={rightRef}
            order={3}
            collapsible
            collapsedSize={0}
            defaultSize={rightCollapsed ? 0 : 20}
            minSize={14}
            onCollapse={() => setRightCollapsed(true)}
            onExpand={() => setRightCollapsed(false)}
          >
            <RightPanel />
          </Panel>
        </PanelGroup>
      </div>

      <StatusBar />

      {settingsOpen && (
        <SettingsDialog initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
}
