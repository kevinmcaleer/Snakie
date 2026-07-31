import { useCallback, useEffect, useRef, useState } from 'react'
import type { PartSide } from '../../../shared/part'

/** How long the spin takes. Matches the Part Editor's flip so the gesture reads
 *  as the same one wherever a board turns over. */
export const COIN_FLIP_MS = 420

/**
 * The coin-spin between a board's two faces (#636).
 *
 * The board turns about its vertical axis and the face swaps at the HALFWAY
 * point, while it is edge-on — swap it at either end and you see the new face
 * rotate in, which reads as a card turning rather than a board flipping over.
 *
 * The caller renders `face` and puts a class on the element while `flipping`; the
 * animation itself is CSS, so `prefers-reduced-motion` can replace the spin with
 * a fade without this hook knowing.
 *
 * Rapid in-and-out is the case that matters — a pointer skimming a grid of cards
 * fires enter/leave far faster than the animation. `flipTo` is idempotent for a
 * face already showing or already being flipped to, and re-targeting mid-spin
 * retimes cleanly rather than leaving the board stuck edge-on.
 */
export function useCoinFlip(durationMs = COIN_FLIP_MS): {
  face: PartSide
  flipping: boolean
  flipTo: (next: PartSide) => void
} {
  const [face, setFace] = useState<PartSide>('front')
  const [flipping, setFlipping] = useState(false)
  /** The face we are heading to — `face` still holds the one on screen. */
  const target = useRef<PartSide>('front')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clear = (): void => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => clear, [])

  const flipTo = useCallback(
    (next: PartSide): void => {
      if (target.current === next) return
      target.current = next
      clear()
      setFlipping(true)
      timers.current.push(
        setTimeout(() => setFace(next), durationMs / 2),
        setTimeout(() => setFlipping(false), durationMs)
      )
    },
    [durationMs]
  )

  return { face, flipping, flipTo }
}
