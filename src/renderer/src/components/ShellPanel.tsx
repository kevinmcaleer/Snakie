import { PanelHeader } from './PanelHeader'
import { Placeholder } from './Placeholder'

/**
 * BOTTOM — shell / console (REPL) region.
 *
 * This is core to a MicroPython tool and is therefore OPEN by default. Later
 * this hosts the REPL with colour highlighting and a clear-console action
 * (the feedback specifically praised the trashcan clear button).
 *
 * Replace the <Placeholder> body with the real REPL/console.
 */
export function ShellPanel(): JSX.Element {
  return (
    <section className="region region--shell" aria-label="Shell">
      <PanelHeader title="Shell" />
      <div className="region__body">
        <Placeholder label="Shell" hint="MicroPython REPL / console goes here." />
      </div>
    </section>
  )
}
