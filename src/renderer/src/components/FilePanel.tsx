import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { LocalFileTree } from './LocalFileTree'
import { DeviceFileTree } from './DeviceFileTree'
import { UploadControls } from './UploadControls'

/**
 * LEFT SIDEBAR — file panels region.
 *
 * Stacks two browsers — the local filesystem (issue #5) and the connected
 * device (issue #7) — with a DRAGGABLE splitter between them (issue #124) so you
 * can give the device tree more room (it used to be capped at 40% height). The
 * split ratio persists across sessions via `autoSaveId`. The transfer bridge
 * (UploadControls) leads into the device pane, keeping the up/down direction
 * matched to the layout (issue #9).
 */
export function FilePanel(): JSX.Element {
  return (
    <section className="region region--files" aria-label="Files">
      <div className="region__body filepanel">
        <PanelGroup direction="vertical" autoSaveId="snakie.files.split">
          <Panel order={1} minSize={15} defaultSize={55} className="filepanel__pane">
            <LocalFileTree />
          </Panel>
          <PanelResizeHandle className="resize-handle resize-handle--horizontal" />
          <Panel order={2} minSize={15} defaultSize={45} className="filepanel__pane">
            <UploadControls />
            <section className="filepanel__device">
              <DeviceFileTree />
            </section>
          </Panel>
        </PanelGroup>
      </div>
    </section>
  )
}
