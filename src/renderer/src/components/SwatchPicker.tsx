import './SwatchPicker.css'

/** A colour well (native `<input type="color">`) + quick-pick swatches of the colours
 *  already in use. Shared by the Part Editor and the Robot View's link-colour control. */
export function SwatchPicker({
  value,
  fallback,
  used,
  onChange,
  ariaLabel
}: {
  value?: string
  fallback: string
  used: string[]
  onChange: (c: string) => void
  ariaLabel?: string
}): JSX.Element {
  return (
    <div className="swatchpick">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? (value as string) : fallback}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      {used.length > 0 && (
        <div className="swatchpick__row">
          {used.map((c) => (
            <button
              key={c}
              type="button"
              className="swatchpick__chip"
              style={{ background: c }}
              title={c}
              aria-label={`Use ${c}`}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
