import { Fragment } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { NOTES, blocks, byDay, dayLabel, spans, type ReleaseNote } from './notes'
import './WhatsNew.css'

/** How many feature names the card lists before "and N more". */
export const CARD_TITLES = 3

function Inline({ text }: { text: string }): JSX.Element {
  return (
    <>
      {spans(text).map((s, i) =>
        s.kind === 'strong' ? (
          <strong key={i}>{s.text}</strong>
        ) : s.kind === 'code' ? (
          <code key={i}>{s.text}</code>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        )
      )}
    </>
  )
}

function Note({ note, fresh }: { note: ReleaseNote; fresh: boolean }): JSX.Element {
  return (
    <article className="whatsnew-note" aria-labelledby={`whatsnew-${note.id}`}>
      <h4 id={`whatsnew-${note.id}`}>
        {note.title}
        {fresh && <span className="whatsnew-new">New</span>}
      </h4>
      {blocks(note.body).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        ) : (
          <ul key={i}>
            {b.items.map((t, j) => (
              <li key={j}>
                <Inline text={t} />
              </li>
            ))}
          </ul>
        )
      )}
    </article>
  )
}

/** Help ▸ What's new: every note, newest day first, with the ones you hadn't seen marked New. */
export function WhatsNewDialog({
  fresh,
  onClose
}: {
  fresh: readonly string[]
  onClose: () => void
}): JSX.Element {
  const isNew = new Set(fresh)
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  return (
    <div
      className="whatsnew-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="whatsnew-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsnew-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <div className="whatsnew-dialog__head">
          <h2 className="whatsnew-dialog__title" id="whatsnew-title">
            <span className="whatsnew-dialog__star" aria-hidden="true">
              ★
            </span>
            What&rsquo;s new
          </h2>
          <button type="button" className="btn btn--ghost whatsnew-dialog__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="whatsnew-dialog__body">
          {byDay(NOTES).map((day) => (
            <section key={day.date} aria-label={dayLabel(day.date)}>
              <h3 className="whatsnew-day">{dayLabel(day.date)}</h3>
              {day.notes.map((n) => (
                <Note key={n.id} note={n} fresh={isNew.has(n.id)} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The note after an update: the new feature names, a way to read more, and a way to put it away. */
export function WhatsNewCard({
  fresh,
  onOpen,
  onDismiss
}: {
  fresh: readonly string[]
  onOpen: () => void
  onDismiss: () => void
}): JSX.Element | null {
  const titles = fresh
    .map((id) => NOTES.find((n) => n.id === id)?.title)
    .filter((t): t is string => !!t)
  if (!titles.length) return null
  const shown = titles.slice(0, CARD_TITLES)
  const more = titles.length - shown.length
  return (
    <aside className="whatsnew-card" aria-label="What's new">
      <div className="whatsnew-card__head">
        <strong>New in Snakie</strong>
        <button
          type="button"
          className="whatsnew-card__dismiss"
          aria-label="Dismiss what's new"
          title="Dismiss"
          onClick={onDismiss}
        >
          ✕
        </button>
      </div>
      <ul>
        {shown.map((t) => (
          <li key={t}>{t}</li>
        ))}
        {more > 0 && <li>and {more} more</li>}
      </ul>
      <button type="button" className="btn btn--primary whatsnew-card__open" onClick={onOpen}>
        See what&rsquo;s new
      </button>
    </aside>
  )
}
