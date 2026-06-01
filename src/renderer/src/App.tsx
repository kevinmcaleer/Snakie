import { AppShell } from './components/AppShell'
import { UpdateNotifier } from './components/UpdateNotifier'
import { WorkspaceProvider } from './store/workspace'

function App(): JSX.Element {
  return (
    <WorkspaceProvider>
      <AppShell />
      <UpdateNotifier />
    </WorkspaceProvider>
  )
}

export default App
