import { PanelHeader } from './PanelHeader'
import { LocalFileTree } from './LocalFileTree'
import { DeviceFileTree } from './DeviceFileTree'

/**
 * LEFT SIDEBAR — file panels region.
 *
 * Stacks two browsers: the local filesystem (issue #5, implemented here) and
 * the connected device (issue #7, placeholder seam below). Per the feedback,
 * file management is a collapsible *pane*, never a separate screen, so it lives
 * permanently in the layout.
 */
export function FilePanel(): JSX.Element {
  return (
    <section className="region region--files" aria-label="Files">
      <PanelHeader title="Files" />
      <div className="region__body filepanel">
        <section className="filepanel__local">
          <LocalFileTree />
        </section>
        <section className="filepanel__device">
          <DeviceFileTree />
        </section>
      </div>
    </section>
  )
}
