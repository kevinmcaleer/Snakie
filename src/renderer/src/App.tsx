import { AppShell } from './components/AppShell'
import { BoardCaptureHost } from './components/BoardCaptureHost'
import { DeviceQueueDialog } from './components/DeviceQueueDialog'
import { PromptProvider } from './components/PromptModal'
import { RefactorPreview } from './components/RefactorPreview'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'
import { SettingsProvider } from './store/settings'
import { ConsoleProvider } from './store/console'
import { SyncProvider } from './store/sync'
import { FileSelectionProvider } from './store/file-selection'
import { LayoutProvider } from './store/layout'
import { TutorialsProvider } from './store/tutorials'
import { IS_WEB } from './lib/env'

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
