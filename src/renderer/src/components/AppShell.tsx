import { useRef } from 'react'
import { ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTheme } from '../hooks/useTheme'
import { Toolbar } from './Toolbar'
import { FilePanel } from './FilePanel'
import { EditorArea } from './EditorArea'
import { ShellPanel } from './ShellPanel'
import { RightPanel } from './RightPanel'

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

  // Persisted collapsed state. Shell is open by default (core REPL tool);
  // the right pane is collapsed by default to keep things uncluttered.
  const [filesCollapsed, setFilesCollapsed] = useLocalStorage('snakie.collapsed.files', false)
  const [shellCollapsed, setShellCollapsed] = useLocalStorage('snakie.collapsed.shell', false)
  const [rightCollapsed, setRightCollapsed] = useLocalStorage('snakie.collapsed.right', true)

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
      />

      <div className="shell__body">
        <PanelGroup direction="horizontal" autoSaveId="snakie.layout.horizontal">
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
            <FilePanel />
          </Panel>

          <PanelResizeHandle className="resize-handle resize-handle--vertical" />

          <Panel order={2} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="snakie.layout.vertical">
              <Panel order={1} minSize={20}>
                <EditorArea />
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
                <ShellPanel />
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
    </div>
  )
}
