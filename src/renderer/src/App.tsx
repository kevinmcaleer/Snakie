import { AppShell } from './components/AppShell'
import { BoardCaptureHost } from './components/BoardCaptureHost'
import { DeviceQueueDialog } from './components/DeviceQueueDialog'
import { PromptProvider } from './components/PromptModal'
import { RefactorPreview } from './components/RefactorPreview'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WhatsNewHost } from './whatsnew/WhatsNewHost'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'
import { SettingsProvider } from './store/settings'
import { ConsoleProvider } from './store/console'
import { SyncProvider } from './store/sync'
import { FileSelectionProvider } from './store/file-selection'
import { LayoutProvider } from './store/layout'
import { TutorialsProvider } from './store/tutorials'
import { IS_WEB } from './lib/env'
import { StarterFile } from './components/StarterFile'
import { OpenFromUrl } from './code-embed/OpenFromUrl'

function App(): JSX.Element {
  return (
    <PromptProvider>
      <SettingsProvider>
        {/* No chat right-pane on the web build — the layout store must know so
            panel sizes map to the right slots (#528). */}
        <LayoutProvider chatPane={!IS_WEB}>
          <WorkspaceProvider>
            {/* What is highlighted in each half of the Files panel (#848).
                Above SyncProvider because folder sync needs the device
                selection to know where a synced folder lands. */}
            <FileSelectionProvider>
              <SyncProvider>
                <DiagnosticsProvider>
                  <ConsoleProvider>
                    <TutorialsProvider>
                      <AppShell />
                      <UpdateNotifier />
                      {/* What's new: a card naming the new features once after
                        an update, and the full list from Help. */}
                      <WhatsNewHost />
                      {/* The board-is-busy modal (#837): renders nothing until
                        a device file operation is queued. */}
                      <DeviceQueueDialog />
                      {/* The refactoring diff preview (#634): renders nothing
                        until a refactoring is proposed from the editor. */}
                      <RefactorPreview />
                      {/* The board the PDF export photographs when the
                        Electronics view isn't open (#1110): renders nothing
                        until an export asks for one. It belongs HERE, inside
                        the providers — a BoardPane mounted in a React root of
                        its own has no workspace and throws. */}
                      <BoardCaptureHost />
                      {/* "Open in Snakie" from a code embed or a kevsrobots
                        lesson (#1287, kevsrobots.com#581): opens the shared
                        code as a new tab — from the address bar on the web,
                        from a `snakie://open…` link on the desktop. */}
                      {/* A brand-new user's first launch opens a small program
                        that runs as it is, instead of an empty editor. Before
                        OpenFromUrl so it reads the address bar first. */}
                      <StarterFile />
                      <OpenFromUrl />
                    </TutorialsProvider>
                  </ConsoleProvider>
                </DiagnosticsProvider>
              </SyncProvider>
            </FileSelectionProvider>
          </WorkspaceProvider>
        </LayoutProvider>
      </SettingsProvider>
    </PromptProvider>
  )
}

export default App
