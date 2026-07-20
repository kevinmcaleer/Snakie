import type { JSX } from 'react'
import { ClosedBookIcon } from './help-icons'

/**
 * Line icons for UI chrome that previously used emoji (#549).
 *
 * Emoji render as tofu on Linux desktops with no colour-emoji font installed —
 * Raspberry Pi OS ships none, so DejaVu Sans is the fallback and everything in
 * the U+1F300+ plane is a blank box. These are plain SVG so they render the
 * same everywhere.
 *
 * Same conventions as {@link file://./help-icons.tsx}: 24×24 viewBox, stroked
 * with `currentColor` so callers tint them via CSS `color`, and `aria-hidden`
 * because every call site already carries its own `title`/`aria-label`.
 */

const svg = (children: JSX.Element, extra?: number): JSX.Element => (
  <svg width={extra ?? 16} height={extra ?? 16} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {children}
  </svg>
)

/** Stroke defaults shared by every icon below. */
const g = (children: JSX.Element): JSX.Element => (
  <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </g>
)

/** Parts flying apart — exploded view (#499). */
export const ExplodeIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
        <path d="M8.2 8.2 4.6 4.6M15.8 8.2l3.6-3.6M8.2 15.8l-3.6 3.6M15.8 15.8l3.6 3.6" />
        <path d="M4 8.2V4h4.2M20 8.2V4h-4.2M4 15.8V20h4.2M20 15.8V20h-4.2" />
      </>
    ),
    size
  )

/** Clapperboard — save the animation as a video. */
export const ClapperIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <rect x="3" y="9.4" width="18" height="10.6" rx="1.6" />
        <path d="M3.2 6.2 20.3 3.5l.6 3.8L3.8 10z" />
        <path d="M8.4 5.4 6.9 9.2M13.6 4.6 12.1 8.4M18.6 3.8 17.1 7.6" />
      </>
    ),
    size
  )

/** A bone — Bone Mode skeleton overlay (#536). */
export const BoneIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M8.2 15.8 15.8 8.2" strokeWidth="2.2" />
        <circle cx="8.5" cy="18.5" r="2" />
        <circle cx="5.5" cy="15.5" r="2" />
        <circle cx="18.5" cy="8.5" r="2" />
        <circle cx="15.5" cy="5.5" r="2" />
      </>
    ),
    size
  )

/** Concentric target — the interactive IK goal (#540). */
export const TargetIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      </>
    ),
    size
  )

/** Camera — Capture Pose (#540). */
export const CameraIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M4 8.2h3.1l1.6-2.4h6.6l1.6 2.4H20a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8.2z" />
        <circle cx="12" cy="13.4" r="3.4" />
      </>
    ),
    size
  )

/** Ruler — the measure HUD readout. */
export const RulerIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <rect x="2.5" y="8.6" width="19" height="6.8" rx="1.2" />
        <path d="M6.6 8.6v3M10.1 8.6v4.2M13.6 8.6v3M17.1 8.6v4.2" />
      </>
    ),
    size
  )

/** Lightbulb — discovery tips (#434) and tutorial tips. */
export const BulbIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M12 3.2a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6v.4h5.4v-.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3.2z" />
        <path d="M9.9 18.5h4.2M10.6 20.8h2.8" />
      </>
    ),
    size
  )

/** An open folder — "Open…" buttons. */
export const FolderOpenIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M3 18.5V5.9A1.4 1.4 0 0 1 4.4 4.5h4.1l2 2.6h6.6a1.4 1.4 0 0 1 1.4 1.4v1.3" />
        <path d="M3.3 19.2 6 11.6a1.2 1.2 0 0 1 1.1-.8h13.6a.9.9 0 0 1 .85 1.2l-2.5 7a1.2 1.2 0 0 1-1.1.8H4.4a1.2 1.2 0 0 1-1.1-1.6z" />
      </>
    ),
    size
  )

/** Trophy — the build checklist, complete (#436). */
export const TrophyIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M8 4.2h8v4.9a4 4 0 0 1-8 0z" />
        <path d="M8 5.8H5.4v1.3a3.1 3.1 0 0 0 3 3.1M16 5.8h2.6v1.3a3.1 3.1 0 0 1-3 3.1" />
        <path d="M12 13.1v3.3" />
        <path d="M9.6 16.4h4.8l.7 3.4H8.9z" />
      </>
    ),
    size
  )

/** A robot head — the build checklist, in progress (#436). */
export const RobotIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <rect x="4" y="8.2" width="16" height="11" rx="2.6" />
        <path d="M12 8.2V5.4" />
        <circle cx="12" cy="3.8" r="1.6" />
        <path d="M2.4 12.2v3.2M21.6 12.2v3.2" />
        <circle cx="9.2" cy="12.9" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="14.8" cy="12.9" r="1.3" fill="currentColor" stroke="none" />
        <path d="M9.6 16.3h4.8" />
      </>
    ),
    size
  )

/** Speech bubble — the shell's chat/ask affordance. */
export const ChatIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <path d="M20.5 12.2c0 3.8-3.8 6.9-8.5 6.9-1.1 0-2.1-.2-3.1-.5L4 20.4l1.4-3.5a6.5 6.5 0 0 1-1.9-4.7c0-3.8 3.8-6.9 8.5-6.9s8.5 3.1 8.5 6.9z" />
    ),
    size
  )

/** A closed padlock — a locked field in the Part Editor. */
export const LockIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <rect x="4.9" y="10.6" width="14.2" height="9.4" rx="1.8" />
        <path d="M8.3 10.6V7.9a3.7 3.7 0 0 1 7.4 0v2.7" />
      </>
    ),
    size
  )

/** An open padlock — an unlocked field in the Part Editor. */
export const UnlockIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <rect x="4.9" y="10.6" width="14.2" height="9.4" rx="1.8" />
        <path d="M8.3 10.6V7.9a3.7 3.7 0 0 1 7.2-1.2" />
      </>
    ),
    size
  )

/** A wastebasket — delete. */
export const TrashIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M4.6 6.9h14.8" />
        <path d="M9.6 6.9V4.7h4.8v2.2" />
        <path d="M6.6 6.9l.85 12.2a1.5 1.5 0 0 0 1.5 1.4h6.1a1.5 1.5 0 0 0 1.5-1.4l.85-12.2" />
        <path d="M10.3 10.4v6.4M13.7 10.4v6.4" />
      </>
    ),
    size
  )

/** A speaker with waves — SAM's SPEAK button. */
export const SpeakerIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M3.5 9.4h3.4L11.4 5.5v13L6.9 14.6H3.5z" />
        <path d="M15 9.3a4 4 0 0 1 0 5.4M17.9 6.7a7.8 7.8 0 0 1 0 10.6" />
      </>
    ),
    size
  )

/** A confetti burst — the build checklist's completion message (#436). */
export const ConfettiIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M4 20.4 9.6 8.9l5.5 5.5z" />
        <path d="M14.6 3.6v2.6M19.2 4.9l-1.8 1.8M20.8 9.6h-2.6M19.9 14.2l-1.9-1.1M15.5 10.6l1.1 1.9" />
      </>
    ),
    size
  )

/** A chick — the beginner course track. */
export const ChickIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <circle cx="11.4" cy="14.6" r="5.6" />
        <circle cx="11.4" cy="6.7" r="3.7" />
        <path d="M14.9 6.3 17.7 7.4 14.9 8.5z" />
        <circle cx="12.7" cy="6" r="0.9" fill="currentColor" stroke="none" />
        <path d="M9.2 19.9 8.3 21.6M13.6 19.9 14.5 21.6" />
      </>
    ),
    size
  )

/** A jointed robot arm — the URDF / robot-building course track. */
export const ArmIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <path d="M4.8 20.8h6.6" />
        <path d="M8.1 20.8v-4.6" />
        <circle cx="8.1" cy="14.6" r="1.7" />
        <path d="M9.3 13.4 13.1 9.6" />
        <circle cx="14.3" cy="8.4" r="1.7" />
        <path d="M15.5 7.2 17.4 5.3" />
        <path d="M17.4 5.3 20.3 4.8M17.4 5.3 17.9 2.4" />
      </>
    ),
    size
  )

/**
 * Course-card thumbnail for the Learn panel (#549).
 *
 * Courses declare a thumbnail as an emoji in their `course.yml`, which is
 * invisible on a Linux box with no emoji font. Map the ones we ship to icons;
 * anything else falls back to the raw emoji so a course author using an
 * unmapped glyph still gets whatever their platform can render.
 */
export const CourseIcon = ({ emoji, size }: { emoji: string; size?: number }): JSX.Element => {
  const known: Record<string, ({ size }: { size?: number }) => JSX.Element> = {
    '🐣': ChickIcon,
    '🤖': RobotIcon,
    '🦾': ArmIcon,
    '📘': ClosedBookIcon
  }
  const Icon = known[emoji]
  return Icon ? <Icon size={size} /> : <>{emoji}</>
}

/** A plumb bob over a base line — the centre-of-mass / balance overlay (#558). */
export const BalanceIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <circle cx="12" cy="7" r="3" />
        <path d="M12 10v7.5" strokeDasharray="1.5 2" />
        <path d="M5 20.5h14" strokeWidth="2" />
        <path d="M12 17.5l-2.4 3h4.8z" fill="currentColor" stroke="none" />
      </>
    ),
    size
  )

/** A cylinder — the "add a tube" build primitive. */
export const CylinderIcon = ({ size }: { size?: number }): JSX.Element =>
  svg(
    g(
      <>
        <ellipse cx="12" cy="6.6" rx="7" ry="2.8" />
        <path d="M5 6.6v10.8c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V6.6" />
      </>
    ),
    size
  )
