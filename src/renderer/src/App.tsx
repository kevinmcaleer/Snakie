import { AppShell } from './components/AppShell'
import { PromptProvider } from './components/PromptModal'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'
import { DiagnosticsProvider } from './store/diagnostics'

function App(): JSX.Element {
  return (
    <PromptProvider>
      <WorkspaceProvider>
        <DiagnosticsProvider>
          <AppShell />
          <UpdateNotifier />
        </DiagnosticsProvider>
      </WorkspaceProvider>
    </PromptProvider>
  )
}

export default App
