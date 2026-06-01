import { PanelHeader } from './PanelHeader'
import { RightPanelTabs, RightPanelTab } from './RightPanelTabs'
import { HelpPanel } from './HelpPanel'
import { OutlinePanel } from './OutlinePanel'
import { VariablesPanel } from './VariablesPanel'
import { PackagesPanel } from './PackagesPanel'

/**
 * RIGHT PANE — optional/collapsible region (collapsed by default).
 *
 * Now a TABBED HOST (issue #22) for progressively-disclosed tooling. The pane
 * is just a thin wrapper: it owns the list of `tabs` and hands it to
 * <RightPanelTabs>, which renders the strip and active panel.
 *
 * ADDING A TAB (for future tools — LLM chat #18, package installer #20,
 * variables #16, serial plotter, …):
 *   1. Build your tool as its own component under `components/` (co-locate a
 *      `.css` you import, like HelpPanel does).
 *   2. Append a `RightPanelTab` to the `tabs` array below:
 *        { id: 'chat', title: 'Chat', icon: '💬', content: <ChatPanel /> }
 *      `id` must be unique + stable; array order = strip order.
 * See RightPanelTabs.tsx for the full contract.
 */
export function RightPanel(): JSX.Element {
  const tabs: RightPanelTab[] = [
    { id: 'help', title: 'Help', icon: '?', content: <HelpPanel /> },
    // Code outline of the active file (issue #16):
    { id: 'outline', title: 'Outline', icon: '☰', content: <OutlinePanel /> },
    // Connected board's variables (issue #16):
    { id: 'vars', title: 'Variables', icon: '{}', content: <VariablesPanel /> },
    // MicroPython package installer (mip/PyPI) with discovery (issue #20):
    { id: 'packages', title: 'Packages', icon: '📦', content: <PackagesPanel /> }
    // Future tabs register here, e.g.:
    // { id: 'chat', title: 'Chat', icon: '💬', content: <ChatPanel /> },
  ]

  return (
    <section className="region region--right" aria-label="Side panel">
      <PanelHeader title="Panel" />
      <div className="region__body">
        <RightPanelTabs tabs={tabs} defaultTabId="help" />
      </div>
    </section>
  )
}
