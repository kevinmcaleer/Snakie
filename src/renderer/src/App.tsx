import { AppShell } from './components/AppShell'
import { PromptProvider } from './components/PromptModal'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'
import { SettingsProvider } from './store/settings'
import { ConsoleProvider } from './store/console'

function App(): JSX.Element {
  return (
    <PromptProvider>
      <SettingsProvider>
        <WorkspaceProvider>
          <DiagnosticsProvider>
            <ConsoleProvider>
              <AppShell />
              <UpdateNotifier />
            </ConsoleProvider>
          </DiagnosticsProvider>
        </WorkspaceProvider>
      </SettingsProvider>
    </PromptProvider>
  )
}

export default App
