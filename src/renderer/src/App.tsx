import { AppShell } from './components/AppShell'
import { PromptProvider } from './components/PromptModal'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'
import { SettingsProvider } from './store/settings'
import { ConsoleProvider } from './store/console'
import { SyncProvider } from './store/sync'

function App(): JSX.Element {
  return (
    <PromptProvider>
      <SettingsProvider>
        <WorkspaceProvider>
          <SyncProvider>
            <DiagnosticsProvider>
              <ConsoleProvider>
                <AppShell />
                <UpdateNotifier />
              </ConsoleProvider>
            </DiagnosticsProvider>
          </SyncProvider>
        </WorkspaceProvider>
      </SettingsProvider>
    </PromptProvider>
  )
}

export default App
