import { AppShell } from './components/AppShell'
import { PromptProvider } from './components/PromptModal'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'
import { SettingsProvider } from './store/settings'
import { ConsoleProvider } from './store/console'
import { SyncProvider } from './store/sync'
import { LayoutProvider } from './store/layout'
import { TutorialsProvider } from './store/tutorials'

function App(): JSX.Element {
  return (
    <PromptProvider>
      <SettingsProvider>
        <LayoutProvider>
          <WorkspaceProvider>
            <SyncProvider>
              <DiagnosticsProvider>
                <ConsoleProvider>
                  <TutorialsProvider>
                    <AppShell />
                    <UpdateNotifier />
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
