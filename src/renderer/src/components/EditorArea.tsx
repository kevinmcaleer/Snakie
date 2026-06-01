import { PanelHeader } from './PanelHeader'
import { MonacoEditor } from './MonacoEditor'
import { EditorTabs } from './EditorTabs'

/**
 * CENTER — editor region.
 *
 * Hosts the Monaco-backed code editor bound to the workspace's active file
 * (issue #3), with the tabbed strip for open files mounted above it (issue #4).
 */
export function EditorArea(): JSX.Element {
  return (
    <section className="region region--editor" aria-label="Editor">
      <PanelHeader title="Editor" />
      <EditorTabs />
      <div className="region__body region__body--editor">
        <MonacoEditor />
      </div>
    </section>
  )
}
