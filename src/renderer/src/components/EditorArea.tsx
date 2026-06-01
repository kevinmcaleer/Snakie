import { PanelHeader } from './PanelHeader'
import { MonacoEditor } from './MonacoEditor'

/**
 * CENTER — editor region.
 *
 * Hosts the Monaco-backed code editor bound to the workspace's active file
 * (issue #3). The tabbed tab strip is a separate issue (#4); this region simply
 * renders the active document.
 */
export function EditorArea(): JSX.Element {
  return (
    <section className="region region--editor" aria-label="Editor">
      <PanelHeader title="Editor" />
      <div className="region__body region__body--editor">
        <MonacoEditor />
      </div>
    </section>
  )
}
