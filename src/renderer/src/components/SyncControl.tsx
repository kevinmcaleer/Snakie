import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PartDefinition, PartLibraryWithParts } from '../../../shared/part'
import type { RobotDefinition } from '../../../shared/robot'
import { blankRobot } from '../../../shared/robot'
import { readRobotModel } from '../../../shared/krf'
import { computeSyncPlan, reAddedPartRow, type SyncItem } from './sync-plan'
import { attachPartBody, mirroredOrigin, partBodyPlan, queueUrdfEdit } from './robot-part-mesh'
import { errorMessage, reportError } from '../lib/report-error'
import { canvasPxPerMm, postAddBodyDims } from './project-parts'
import {
  meshImportScale,
  readInertial,
  removeLink,
  setInertial,
  swapLinkVisualToMesh
} from './robot-assembly'
import './SyncControl.css'

/**
 * ELECTRONICS ↔ BUILD SYNC (#717, epic #720) — the button-with-badge and the
 * reconcile dialog behind it, mounted IDENTICALLY in the Electronics workspace
 * (both board hosts) and the Build workspace. Deliberately SELF-CONTAINED: it
 * loads robot.yml, the libraries and the URDF itself off the shared change
 * buses, so the three mounts cannot diverge the way host-fed props have before
 * (#453) — a host hands it nothing but the project folder.
 *
 * The plan is {@link computeSyncPlan}; nothing here decides — every destructive
 * choice is a button the user clicks (per #626: flag, don't auto-delete).
 * Additive fixes reuse the placement bridge, URDF edits ride its serialisation
 * chain, and EVERY robot.yml write is a targeted merge in main (`patchModel` /
 * `patchPartLinks`): the local copy here is for PLANNING only — actions finish
 * seconds after their click, and saving this component's by-then-stale whole
 * document back would revert concurrent edits (the exact anti-pattern #716's
 * review killed in the placement bridge).
 */
export function SyncControl({ folder }: { folder: string | null | undefined }): JSX.Element | null {
  const [robot, setRobot] = useState<RobotDefinition>(() => blankRobot())
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>([])
  const [urdfText, setUrdfText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const loadSeqRef = useRef(0)

  // One reload path off the shared buses — robot.yml saves anywhere, URDF
  // rewrites anywhere, parts-library changes.
  useEffect(() => window.api.robot.onChanged(() => setNonce((n) => n + 1)), [])
  useEffect(() => window.api.robot.onUrdfChanged(() => setNonce((n) => n + 1)), [])
  useEffect(() => window.api.parts.onChanged?.(() => setNonce((n) => n + 1)) ?? undefined, [])
  useEffect(() => {
    const seq = ++loadSeqRef.current
    const fresh = (): boolean => seq === loadSeqRef.current
    void (async (): Promise<void> => {
      const r = await window.api.robot.load(folder ?? undefined).catch(() => blankRobot())
      const libs = await window.api.parts.listLibraries().catch(() => [])
      let urdf: string | null = null
      const rel = readRobotModel(r)?.urdf
      if (rel && folder) {
        urdf = await window.api.fs
          .readFile(`${folder.replace(/[/\\]$/, '')}/${rel}`)
          .catch(() => null)
      }
      if (fresh()) {
        setRobot(r)
        setLibraries(libs as PartLibraryWithParts[])
        setUrdfText(urdf)
      }
    })()
  }, [folder, nonce])

  const plan = useMemo(
    () => (folder ? computeSyncPlan(robot, urdfText, libraries) : []),
    [robot, urdfText, libraries, folder]
  )

  const urdfName = readRobotModel(robot)?.urdf || 'robot.urdf'
  const resolveDef = useCallback(
    (lib: string | undefined, partId: string | undefined): PartDefinition | undefined => {
      for (const l of libraries) {
        if (lib && l.id !== lib) continue
        const hit = l.parts?.find((p) => p.id === partId)
        if (hit) return hit
      }
      return undefined
    },
    [libraries]
  )

  /** Add the missing Build body for one plan item (part or the MCU board). */
  const addBody = useCallback(
    async (item: Extract<SyncItem, { kind: 'missing-body' }>): Promise<void> => {
      if (!folder) return
      // Link robot.urdf into the manifest FIRST when the project has none —
      // without this record, every Build view keeps resolving "no model" and the
      // fresh body is invisible (and a re-click would mint a duplicate link).
      await window.api.robot.patchModel(folder, { ensureUrdf: urdfName }).catch(() => undefined)
      const pxPerMm = canvasPxPerMm(postAddBodyDims(robot, libraries, []))
      if (item.partId === 'board') {
        // The MCU: find its part def AND its library (attachPartBody needs the
        // lib id to resolve a bundled mesh, should the board part ever ship one).
        let boardLib = ''
        let def: PartDefinition | undefined
        for (const l of libraries) {
          const hit = l.parts?.find((p) => p.id === robot.board)
          if (hit) {
            def = hit
            boardLib = l.id
            break
          }
        }
        if (!def) return
        const at = mirroredOrigin({ x: robot.boardX, y: robot.boardY }, def, pxPerMm)
        const body = await attachPartBody(folder, urdfName, boardLib, def, at)
        if (body.problem) reportError('build: part mesh', body.problem, { notify: body.problem })
        if (body.link) {
          await window.api.robot.patchModel(folder, { boardLink: body.link }).catch(() => undefined)
        }
        return
      }
      const row = robot.parts.find((p) => p.id === item.partId)
      const def = row && resolveDef(row.lib, row.part)
      if (!row || !def) return
      const at = mirroredOrigin(row, def, pxPerMm)
      const body = await attachPartBody(folder, urdfName, row.lib, def, at)
      if (body.problem) reportError('build: part mesh', body.problem, { notify: body.problem })
      if (body.link) await window.api.robot.patchPartLinks(folder, [{ partId: row.id, link: body.link }])
    },
    [folder, robot, libraries, urdfName, resolveDef]
  )

  /** Swap a footprint box for the part's now-available mesh IN PLACE — the
   *  link, its joint, its children and its inertial are untouched. */
  const upgradeToMesh = useCallback(
    async (item: Extract<SyncItem, { kind: 'placeholder-upgradable' }>): Promise<void> => {
      if (!folder) return
      const row = robot.parts.find((p) => p.id === item.partId)
      const def = row && resolveDef(row.lib, row.part)
      if (!row || !def?.mesh) return
      const res = await window.api.robot
        .importPartMesh(`${folder.replace(/[/\\]$/, '')}/${urdfName}`, row.lib, def.id, def.mesh)
        .catch((err: unknown) => ({ error: errorMessage(err) }))
      const plan = partBodyPlan(def, res)
      if (plan.body !== 'mesh') {
        // The SAME swallow as #787 fault 3, one screen along: a failed copy used
        // to make this button do nothing at all, with the placeholder it was
        // meant to replace still sitting there looking correct.
        if (plan.problem) reportError('build: upgrade to mesh', plan.problem, { notify: plan.problem })
        return
      }
      const rel = plan.meshRel
      const scale = meshImportScale(def, 'maxDim' in res ? res.maxDim : undefined)
      await queueUrdfEdit(folder, urdfName, (urdf) =>
        // The part's mesh orientation (#741) travels with the upgrade — the box
        // it replaces never needed one, so this is the first chance to apply it.
        swapLinkVisualToMesh(urdf, item.link, rel, scale, def.meshRotation)
      )
    },
    [folder, robot, urdfName, resolveDef]
  )

  /** Write the library mass into the link's inertial, PRESERVING its CoM (an
   *  existing CoM — box centre, part-declared, or user-tuned — must survive a
   *  mass update or the stability maths silently corrupts). */
  const applyLibraryMass = useCallback(
    async (item: Extract<SyncItem, { kind: 'mass-drift' }>): Promise<void> => {
      if (!folder) return
      const row = robot.parts.find((p) => p.id === item.partId)
      const def = row && resolveDef(row.lib, row.part)
      await queueUrdfEdit(folder, urdfName, (urdf) => {
        const existing = readInertial(urdf, item.link)?.com
        const declared = def?.com_xyz
          ? ([def.com_xyz[0] / 1000, def.com_xyz[1] / 1000, def.com_xyz[2] / 1000] as [number, number, number])
          : undefined
        return setInertial(urdf, item.link, {
          mass: item.partMassG / 1000,
          com: existing ?? declared ?? [0, 0, 0]
        })
      })
      await window.api.robot
        .patchModel(folder, { linkMass: { link: item.link, source: 'library' } })
        .catch(() => undefined)
    },
    [folder, robot, urdfName, resolveDef]
  )

  /** The #626 three-way for an orphan: keep / remove / re-add. */
  const keepOrphan = useCallback(
    async (item: Extract<SyncItem, { kind: 'orphan-link' }>): Promise<void> => {
      await window.api.robot
        .patchModel(folder ?? undefined, { clearOrphans: [item.ledger] })
        .catch(() => undefined)
    },
    [folder]
  )
  const removeOrphan = useCallback(
    async (item: Extract<SyncItem, { kind: 'orphan-link' }>): Promise<void> => {
      if (!folder) return
      await queueUrdfEdit(folder, urdfName, (urdf) => removeLink(urdf, item.link))
      await window.api.robot
        .patchModel(folder, { clearOrphans: [item.ledger] })
        .catch(() => undefined)
    },
    [folder, urdfName]
  )
  const reAddOrphan = useCallback(
    async (
      item: Extract<SyncItem, { kind: 'orphan-link' }>,
      lib: string,
      partId: string
    ): Promise<void> => {
      const def = resolveDef(lib, partId)
      const row = reAddedPartRow(robot, item.link, lib, partId, def?.name || partId)
      await window.api.robot
        .patchModel(folder ?? undefined, { addParts: [row], clearOrphans: [item.ledger] })
        .catch(() => undefined)
    },
    [folder, robot, resolveDef]
  )

  const run = (id: string, fn: () => Promise<void> | void): void => {
    setBusy(id)
    void Promise.resolve(fn()).finally(() => setBusy(null))
  }

  if (!folder) return null

  return (
    <>
      <button
        type="button"
        className={`esync__button${plan.length ? ' esync__button--due' : ''}`}
        title={
          plan.length
            ? `Electronics and Build differ in ${plan.length} place${plan.length === 1 ? '' : 's'} — review and reconcile`
            : 'Electronics and Build match'
        }
        onClick={() => setOpen(true)}
      >
        ⇄ Sync
        {plan.length > 0 && <span className="esync__badge">{plan.length}</span>}
      </button>

      {open && (
        <div className="esync__scrim" onClick={() => setOpen(false)}>
          <div
            className="esync__dialog"
            role="dialog"
            aria-label="Reconcile Electronics and Build"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="esync__head">
              <span className="esync__title">Electronics ⇄ Build</span>
              <button type="button" className="esync__close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            {plan.length === 0 ? (
              <p className="esync__empty">The two workspaces match — nothing to reconcile.</p>
            ) : (
              <ul className="esync__list">
                {plan.map((item, i) => {
                  const id = `${item.kind}:${'link' in item ? item.link : item.partId}:${i}`
                  const running = busy === id
                  return (
                    <li key={id} className="esync__item">
                      {item.kind === 'missing-body' && (
                        <>
                          <span className="esync__desc">
                            <strong>{item.label}</strong>{' '}
                            {item.dangling
                              ? 'lost its 3-D body (the recorded link is gone)'
                              : 'has no 3-D body in Build'}
                          </span>
                          <span className="esync__acts">
                            <button type="button" disabled={running} onClick={() => run(id, () => addBody(item))}>
                              {running ? 'Adding…' : 'Add to Build'}
                            </button>
                          </span>
                        </>
                      )}
                      {item.kind === 'orphan-link' && (
                        <OrphanRow
                          link={item.link}
                          libraries={libraries}
                          running={running}
                          onKeep={() => run(id, () => keepOrphan(item))}
                          onRemove={() => run(id, () => removeOrphan(item))}
                          onReAdd={(lib, partId) => run(id, () => reAddOrphan(item, lib, partId))}
                        />
                      )}
                      {item.kind === 'placeholder-upgradable' && (
                        <>
                          <span className="esync__desc">
                            <strong>{item.label}</strong> is a stand-in box, but its library part now
                            ships a real mesh
                          </span>
                          <span className="esync__acts">
                            <button type="button" disabled={running} onClick={() => run(id, () => upgradeToMesh(item))}>
                              {running ? 'Upgrading…' : 'Upgrade to mesh'}
                            </button>
                          </span>
                        </>
                      )}
                      {item.kind === 'mass-drift' && (
                        <>
                          <span className="esync__desc">
                            <strong>{item.label}</strong> weighs {item.partMassG} g in the library, but
                            its 3-D body{' '}
                            {item.linkMassKg == null
                              ? 'carries no mass'
                              : `carries ${Math.round(item.linkMassKg * 10000) / 10} g`}
                          </span>
                          <span className="esync__acts">
                            <button type="button" disabled={running} onClick={() => run(id, () => applyLibraryMass(item))}>
                              {running ? 'Applying…' : `Use ${item.partMassG} g`}
                            </button>
                          </span>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** The orphan three-way (#626): keep in Build / remove / re-add to Electronics,
 *  with a part picker for re-add (the link alone can't say which part it was). */
function OrphanRow({
  link,
  libraries,
  running,
  onKeep,
  onRemove,
  onReAdd
}: {
  link: string
  libraries: PartLibraryWithParts[]
  running: boolean
  onKeep: () => void
  onRemove: () => void
  onReAdd: (lib: string, partId: string) => void
}): JSX.Element {
  const [choice, setChoice] = useState('')
  return (
    <>
      <span className="esync__desc">
        <strong>{link}</strong> is orphaned — its Electronics part was deleted
      </span>
      <span className="esync__acts esync__acts--orphan">
        <button type="button" disabled={running} title="It's part of the robot now — clear the flag" onClick={onKeep}>
          Keep in Build
        </button>
        <button
          type="button"
          disabled={running}
          title="Delete the link — and everything jointed below it"
          onClick={onRemove}
        >
          Remove
        </button>
        <select
          value={choice}
          disabled={running}
          aria-label={`Re-add ${link} to Electronics as a part`}
          onChange={(e) => {
            setChoice(e.target.value)
            const [lib, partId] = e.target.value.split('::')
            if (lib && partId) onReAdd(lib, partId)
          }}
        >
          <option value="">Re-add to Electronics as…</option>
          {libraries.map((l) =>
            (l.parts ?? []).map((p) => (
              <option key={`${l.id}::${p.id}`} value={`${l.id}::${p.id}`}>
                {p.name} ({l.id})
              </option>
            ))
          )}
        </select>
      </span>
    </>
  )
}
