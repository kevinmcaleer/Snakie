import { LocalFileTree } from './LocalFileTree'
import { DeviceFileTree } from './DeviceFileTree'
import { UploadControls } from './UploadControls'

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
      <div className="region__body filepanel">
        <section className="filepanel__local">
          <LocalFileTree />
        </section>
        {/* Transfer bridge: sits BETWEEN the computer (above) and board (below)
            panes so the up/down direction matches the layout (issue #9). */}
        <UploadControls />
        <section className="filepanel__device">
          <DeviceFileTree />
        </section>
      </div>
    </section>
  )
}
