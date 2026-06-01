import { AppShell } from './components/AppShell'
import { WorkspaceProvider } from './store/workspace'

function App(): JSX.Element {
  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  )
}

export default App
