import { useEffect, useRef, useState } from 'react'

/** Ease-out cubic: fast start, gentle landing. `t` in [0, 1]. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - c, 3)
}

/** The value `elapsed` ms into an eased tween from `from` to `to`. */
export function tweenValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to
  return from + (to - from) * easeOutCubic(elapsed / duration)
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Follow `target` smoothly: returns a value that eases from where it is now to
 * each new target over `duration` ms (one requestAnimationFrame tween; a new
 * target mid-tween starts from the current in-between value, so rapid clicks
 * never jump). Snaps straight to the target under prefers-reduced-motion.
 */
export function useAnimatedNumber(target: number, duration = 200): number {
  const [value, setValue] = useState(target)
  const valueRef = useRef(target)
  valueRef.current = value

  useEffect(() => {
    const from = valueRef.current
    if (from === target) return
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const step = (now: number): void => {
      const next = tweenValue(from, target, now - start, duration)
      setValue(next)
      if (next !== target) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}
