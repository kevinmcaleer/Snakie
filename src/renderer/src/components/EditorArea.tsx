import { PanelHeader } from './PanelHeader'
import { Placeholder } from './Placeholder'

/**
 * CENTER — editor tabs region.
 *
 * Later this hosts the tabbed code editor. Note the feedback request for a
 * `+` tab affordance for creating new files; the tab strip will live in this
 * region's header/body.
 *
 * Replace the <Placeholder> body with the real editor + tab strip.
 */
export function EditorArea(): JSX.Element {
  return (
    <section className="region region--editor" aria-label="Editor">
      <PanelHeader title="Editor" />
      <div className="region__body">
        <Placeholder label="Editor" hint="Tabbed code editor goes here." />
      </div>
    </section>
  )
}
