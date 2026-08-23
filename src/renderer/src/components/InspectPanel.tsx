import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { OutlinePanel } from './OutlinePanel'
import { VariablesPanel } from './VariablesPanel'

/**
 * INSPECT VIEW (left sidebar).
 *
 * Stacks the code Outline (top) over the device Variables inspector (bottom) in
 * a vertical split, mirroring how the Files view stacks the local and device
 * trees. Uses react-resizable-panels like the other splits so the divider is
 * draggable and sizes persist via `autoSaveId`.
 *
 * SCROLLING (#796): the two panes divide the column between them, so neither can
 * grow to fit its content — a long symbol list has to scroll. A `Panel` is
 * `overflow: hidden` by INLINE style from the library, which no stylesheet rule
 * can override, so the scroll belongs to the list inside each panel
 * (`.outline__list` / `.vars__list`), not to the pane. Same shape as the Files
 * view, where `.filepanel__pane` is hidden and `.localtree__tree` scrolls.
 *
 * The split is stated (60/40, outline-favoured — it is usually the longer of the
 * two) rather than left to the library's implicit even share; `autoSaveId` means
 * this only decides the FIRST run, after which the user's drag wins.
 */
export function InspectPanel(): JSX.Element {
  return (
    <section className="region region--inspect" aria-label="Inspect">
      <div className="region__body inspectpanel">
        <PanelGroup direction="vertical" autoSaveId="snakie.layout.inspect">
          <Panel order={1} minSize={20} defaultSize={60} className="inspectpanel__section">
            <OutlinePanel />
          </Panel>
          <PanelResizeHandle className="resize-handle resize-handle--horizontal" />
          <Panel order={2} minSize={20} defaultSize={40} className="inspectpanel__section">
            <VariablesPanel />
          </Panel>
        </PanelGroup>
      </div>
    </section>
  )
}
