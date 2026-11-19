import { useLocalStorage } from '../hooks/useLocalStorage'
import { bettercadNewRobotUrl } from '../../../shared/links'
import { FolderOpenIcon, RobotIcon } from './ui-icons'
import './BuildEmptyState.css'

/** Remembers that this viewer tucked the card away (a per-viewer convenience). */
export const BUILD_EMPTY_COLLAPSED_KEY = 'snakie.build.emptyState.collapsed'

/**
 * BUILD EMPTY STATE — what the Build workspace shows over the stage when the
 * project has no robot model of its own, so the bundled demo arm is standing in.
 *
 * It names the three ways to get a robot: build one from blocks here (New robot),
 * open a URDF you already have, or design it in BetterCAD by kevsrobots and
 * bring the exported URDF back. An unobtrusive card rather than a modal: the
 * demo arm stays explorable behind it, and × tucks it into a small pill.
 *
 * The BetterCAD hand-off is a plain link for now (export URDF → open it here).
 * When BetterCAD can send a URDF straight back (BetterCad#505), only the copy
 * here and `bettercadNewRobotUrl()` should need to change.
 */
export function BuildEmptyState({
  onNewRobot,
  onOpenRobot
}: {
  onNewRobot: () => void
  onOpenRobot: () => void
}): JSX.Element {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(BUILD_EMPTY_COLLAPSED_KEY, false)

  const openBetterCad = (): void => {
    void window.api?.openExternal?.(bettercadNewRobotUrl()).catch(() => undefined)
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className="buildempty__pill"
        onClick={() => setCollapsed(false)}
        title="This project has no robot yet. Show the ways to start one"
      >
        <RobotIcon size={14} /> Start your robot
      </button>
    )
  }

  return (
    <section className="buildempty" aria-labelledby="buildempty-title">
      <button
        type="button"
        className="buildempty__close"
        onClick={() => setCollapsed(true)}
        title="Hide"
        aria-label="Hide this suggestion"
      >
        ×
      </button>
      <p className="buildempty__eyebrow">No robot in this project yet</p>
      <h2 id="buildempty-title" className="buildempty__title">
        Start your own robot
      </h2>
      <p className="buildempty__body">
        This is the demo arm. Build a robot from blocks here, open a URDF you already have, or
        design one in BetterCAD.
      </p>
      <div className="buildempty__actions">
        <button type="button" className="buildempty__btn buildempty__btn--primary" onClick={onNewRobot}>
          ＋ New robot
        </button>
        <button type="button" className="buildempty__btn" onClick={onOpenRobot}>
          <FolderOpenIcon size={14} /> Open URDF…
        </button>
      </div>
      <button
        type="button"
        className="buildempty__bettercad"
        onClick={openBetterCad}
        title="Opens BetterCAD in your browser"
      >
        <span className="buildempty__bettercad-text">
          <span className="buildempty__bettercad-name">
            Design it in BetterCAD <span aria-hidden="true">↗</span>
          </span>
          <span className="buildempty__bettercad-by">by kevsrobots</span>
        </span>
      </button>
      <p className="buildempty__note">
        In BetterCAD, export a URDF into this project folder, then choose Open URDF… to bring it in.
      </p>
    </section>
  )
}

export default BuildEmptyState
