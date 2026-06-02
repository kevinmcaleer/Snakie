import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { PanelHeader } from './PanelHeader'
import { OutlinePanel } from './OutlinePanel'
import { VariablesPanel } from './VariablesPanel'

/**
 * INSPECT VIEW (left sidebar).
 *
 * Stacks the code Outline (top) over the device Variables inspector (bottom) in
 * a vertical split, mirroring how the Files view stacks the local and device
 * trees. Uses react-resizable-panels like the other splits so the divider is
 * draggable and sizes persist via `autoSaveId`.
 */
export function InspectPanel(): JSX.Element {
  return (
    <section className="region region--inspect" aria-label="Inspect">
      <PanelHeader title="Inspect" />
      <div className="region__body inspectpanel">
        <PanelGroup direction="vertical" autoSaveId="snakie.layout.inspect">
          <Panel order={1} minSize={20} className="inspectpanel__section">
            <OutlinePanel />
          </Panel>
          <PanelResizeHandle className="resize-handle resize-handle--horizontal" />
          <Panel order={2} minSize={20} className="inspectpanel__section">
            <VariablesPanel />
          </Panel>
        </PanelGroup>
      </div>
    </section>
  )
}
