import { AppShell } from './components/AppShell'
import { PromptProvider } from './components/PromptModal'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'

function App(): JSX.Element {
  return (
    <PromptProvider>
      <WorkspaceProvider>
        <AppShell />
        <UpdateNotifier />
      </WorkspaceProvider>
    </PromptProvider>
  )
}

export default App
