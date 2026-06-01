import { PanelHeader } from './PanelHeader'
import { Placeholder } from './Placeholder'

/**
 * RIGHT PANE — optional/collapsible region (collapsed by default).
 *
 * Reserved for progressively-disclosed tooling (e.g. package installer,
 * help/docs, serial plotter, AI assistant) so the default layout stays
 * uncluttered. Replace the <Placeholder> body when a feature claims it.
 */
export function RightPanel(): JSX.Element {
  return (
    <section className="region region--right" aria-label="Side panel">
      <PanelHeader title="Panel" />
      <div className="region__body">
        <Placeholder label="Panel" hint="Optional tools (package installer, help, AI)." />
      </div>
    </section>
  )
}
