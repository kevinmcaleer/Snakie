import { AppShell } from './components/AppShell'
import { PromptProvider } from './components/PromptModal'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'
import { ConsoleProvider } from './store/console'

function App(): JSX.Element {
  return (
    <PromptProvider>
      <WorkspaceProvider>
        <DiagnosticsProvider>
          <ConsoleProvider>
            <AppShell />
            <UpdateNotifier />
          </ConsoleProvider>
        </DiagnosticsProvider>
      </WorkspaceProvider>
    </PromptProvider>
  )
}

export default App
