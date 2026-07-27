/**
 * FootprintField (#166) — a footprint picker for the Part Editor. A footprint is
 * the named compatibility tag that lets a board seat into a carrier (a board's
 * `footprint` must equal a mount's `footprint`); it's free text on disk, so this
 * control offers the known footprints as autocomplete to stop typos while still
 * allowing a brand-new one to be typed. Backed by {@link collectFootprints}.
 *
 * Uses the same native `<input list>` + `<datalist>` combobox pattern as the
 * Part Editor's "Family" field, so it matches the house style with no bespoke
 * dropdown. The typed value is slugified on commit so `XIAO` / `xiao ` converge.
 */

import type { JSX } from 'react'
import { slugifyFootprint, type FootprintInfo } from '../../../shared/footprints'

let uid = 0

export function FootprintField({
  value,
  onChange,
  footprints,
  label = 'Footprint',
  placeholder = 'e.g. xiao',
  hint
}: {
  value: string | undefined
  /** Called with the committed slug, or undefined when cleared. */
  onChange: (footprint: string | undefined) => void
  footprints: FootprintInfo[]
  label?: string
  placeholder?: string
  /** Optional helper line under the field. */
  hint?: string
}): JSX.Element {
  // A stable, unique datalist id so multiple fields on one screen don't collide.
  const listId = `pe-footprints-${(uid = (uid + 1) % 1e6)}`
  return (
    <label className="pe__field pe__field--footprint">
      <span>{label}</span>
      <input
        type="text"
        list={listId}
        value={value ?? ''}
        // Keep the raw text while typing (so a space isn't eaten mid-word); the
        // value is normalised to its slug when the field is committed.
        onChange={(e) => onChange(e.target.value || undefined)}
        onBlur={(e) => onChange(slugifyFootprint(e.target.value) || undefined)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <datalist id={listId}>
        {footprints.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.count ? ` — ${f.count} in use` : f.common ? ' — standard' : ''}
          </option>
        ))}
      </datalist>
      {hint && <small className="pe__hint">{hint}</small>}
    </label>
  )
}
