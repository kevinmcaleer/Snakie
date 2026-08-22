import { AppShell } from './components/AppShell'
import { PromptProvider } from './components/PromptModal'
import { RefactorPreview } from './components/RefactorPreview'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'
import { SettingsProvider } from './store/settings'
import { ConsoleProvider } from './store/console'
import { SyncProvider } from './store/sync'
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
            <SyncProvider>
              <DiagnosticsProvider>
                <ConsoleProvider>
                  <TutorialsProvider>
                    <AppShell />
                    <UpdateNotifier />
                    {/* The refactoring diff preview (#634): renders nothing
                        until a refactoring is proposed from the editor. */}
                    <RefactorPreview />
                  </TutorialsProvider>
                </ConsoleProvider>
              </DiagnosticsProvider>
            </SyncProvider>
          </WorkspaceProvider>
        </LayoutProvider>
      </SettingsProvider>
    </PromptProvider>
  )
}

export default App
