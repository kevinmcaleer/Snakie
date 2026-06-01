import { PanelHeader } from './PanelHeader'
import { Placeholder } from './Placeholder'

/**
 * LEFT SIDEBAR — file panels region.
 *
 * Later this stacks two collapsible browsers: the local filesystem and the
 * connected device. Per the feedback, file management is a collapsible *pane*,
 * never a separate screen, so it lives permanently in the layout.
 *
 * Replace the <Placeholder> body with the real local + device browsers.
 */
export function FilePanel(): JSX.Element {
  return (
    <section className="region region--files" aria-label="Files">
      <PanelHeader title="Files" />
      <div className="region__body">
        <Placeholder label="Files" hint="Local + device file browsers go here." />
      </div>
    </section>
  )
}
