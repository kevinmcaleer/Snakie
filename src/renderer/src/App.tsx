import { useEffect, useState } from 'react'

function App(): JSX.Element {
  const versions = window.api.versions
  const [pong, setPong] = useState<string>('…')

  useEffect(() => {
    window.api
      .ping()
      .then(setPong)
      .catch(() => setPong('error'))
  }, [])

  return (
    <main className="app">
      <h1 className="title">Snakie</h1>
      <p className="subtitle">A modern, cross-platform MicroPython editor.</p>
      <ul className="versions">
        <li>
          Electron <span>{versions.electron}</span>
        </li>
        <li>
          Node <span>{versions.node}</span>
        </li>
        <li>
          Chromium <span>{versions.chrome}</span>
        </li>
      </ul>
      <p className="ipc">
        IPC bridge: <code>ping</code> → <code>{pong}</code>
      </p>
    </main>
  )
}

export default App
