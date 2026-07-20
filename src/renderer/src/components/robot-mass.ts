/**
 * PER-LINK MASS RESOLUTION (#555, epic #535 §1) — turns the three possible
 * sources of a link's mass into one number the editor shows and the URDF stores.
 *
 * A link's mass can come from three places, in descending trust:
 *   1. MEASURED — the user weighed the real part and typed it. Beats everything.
 *   2. LIBRARY  — the placed part carries a real `mass_g` (#554). (Wiring the
 *      link→part lookup is deferred — URDF links record no source-part id — so
 *      this is modelled here and consumed once that mapping exists.)
 *   3. ESTIMATED — mesh volume × material density × infill. A printed part is
 *      mostly air, so this is explicitly an estimate.
 *
 * The physical VALUE is persisted in the URDF `<inertial>` (#553) — portable,
 * standard, readable by ROS. This module holds only the pure maths: producing an
 * estimate from geometry, and picking which source is active. The authoring
 * METADATA (which source, and the material/infill an estimate used) is persisted
 * separately in `robot.yml` (`LinkMassSpec`) so an estimate stays reproducible.
 *
 * All maths is dependency-light (numbers/arrays in, numbers out) so it unit-tests
 * without a renderer, following `robot-mass-geometry.ts` / `robot-explode.ts`.
 */
import {
  MATERIAL_DENSITY_G_CM3,
  estimateMassGrams,
  massGeometry,
  type MassGeometryMethod,
  type MeshTriangles,
  type Vec3
} from './robot-mass-geometry'

/** Where a link's active mass came from. `none` ⇒ no mass known yet. */
export type MassSource = 'measured' | 'library' | 'estimated' | 'none'

/** The default material when a link has never picked one. */
export const DEFAULT_MATERIAL = 'PLA'
/** The default infill fraction (20 % — a common slicer default). */
export const DEFAULT_INFILL = 0.2

/** Ordered material names for a dropdown (keys of {@link MATERIAL_DENSITY_G_CM3}). */
export const MATERIAL_NAMES: readonly string[] = Object.keys(MATERIAL_DENSITY_G_CM3)

export interface MassEstimate {
  /** Estimated mass in grams (0 when the mesh yields no volume). */
  grams: number
  /** Volumetric centroid in millimetres, the CoM default. */
  centroidMm: Vec3
  /** How the volume was obtained — drives the honesty warning. */
  method: MassGeometryMethod
  /** Whether the source mesh was a closed surface. */
  watertight: boolean
}

/**
 * Estimate a link's mass from its mesh triangles.
 *
 * `mesh` positions are in the mesh's own authored units; `unitScaleToMm`
 * converts one of those units to a millimetre (a metre-authored URDF mesh → 1000,
 * a millimetre STL → 1). Volume scales by the cube of that, the centroid linearly.
 */
export function estimateFromMesh(
  mesh: MeshTriangles,
  opts: { material?: string; infill?: number; unitScaleToMm: number }
): MassEstimate {
  const g = massGeometry(mesh)
  const s = opts.unitScaleToMm
  const volumeMm3 = g.volume * s * s * s
  const density = MATERIAL_DENSITY_G_CM3[opts.material ?? DEFAULT_MATERIAL] ??
    MATERIAL_DENSITY_G_CM3[DEFAULT_MATERIAL]
  const infill = opts.infill ?? DEFAULT_INFILL
  return {
    grams: estimateMassGrams(volumeMm3, density, infill),
    centroidMm: [g.centroid[0] * s, g.centroid[1] * s, g.centroid[2] * s],
    method: g.method,
    watertight: g.watertight
  }
}

/** A warning string for an estimate whose mesh wasn't a clean closed solid, or
 *  null when the estimate is trustworthy. */
export function estimateWarning(est: MassEstimate): string | null {
  if (est.method === 'hull') return 'Mesh has holes — volume is a convex-hull over-estimate.'
  if (est.method === 'bbox') return 'Mesh has no solid volume — using its bounding box, a rough guess.'
  if (est.method === 'empty') return 'No mesh geometry — estimate unavailable.'
  return null
}

export interface MassInputs {
  /** A user-entered measured mass in grams, if any (highest trust). */
  measuredG?: number
  /** The placed part's library mass in grams, if any (#554). */
  libraryG?: number
  /** A mesh-volume estimate in grams, if computable. */
  estimateG?: number
}

export interface ResolvedMass {
  /** The grams the editor shows and the URDF stores (0 when nothing is known). */
  grams: number
  source: MassSource
}

/**
 * Pick the active mass + source by trust order: measured → library → estimated.
 *
 * A source counts only when it is a finite, positive number — a 0 g "measured"
 * value is treated as unset (fall through), matching how the parts library and
 * URDF layers drop non-positive masses.
 */
export function resolveMass(inputs: MassInputs): ResolvedMass {
  const usable = (n: number | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0
  if (usable(inputs.measuredG)) return { grams: inputs.measuredG, source: 'measured' }
  if (usable(inputs.libraryG)) return { grams: inputs.libraryG, source: 'library' }
  if (usable(inputs.estimateG)) return { grams: inputs.estimateG, source: 'estimated' }
  return { grams: 0, source: 'none' }
}

/** Grams → URDF kilograms (`<mass value>` is SI). */
export const gramsToKg = (g: number): number => g / 1000
/** URDF kilograms → grams (the editor's unit). */
export const kgToGrams = (kg: number): number => kg * 1000
/** Millimetres → URDF metres (`<origin xyz>` is SI). */
export const mmToM = (mm: number): number => mm / 1000
/** URDF metres → millimetres (the editor's unit). */
export const mToMm = (m: number): number => m * 1000

/** One link's line in the mass breakdown (#555 part 2). */
export interface MassRow {
  link: string
  /** Grams (0 ⇒ no mass set on this link). */
  grams: number
  source: MassSource
}

export interface MassBreakdown {
  /** Rows, heaviest first by default (see {@link summariseMass}). */
  rows: MassRow[]
  /** Total mass in grams across every link that has one. */
  totalG: number
  /** How many links still have no mass — the "finish weighing these" count. */
  unsetCount: number
}

/** How the breakdown table is ordered. */
export type MassSort = 'mass' | 'name'

/**
 * Summarise per-link masses into a total + an ordered table (#555 part 2).
 *
 * `mass` order is heaviest-first so what dominates is obvious at a glance, with
 * link name as a stable tiebreak; `name` order is alphabetical. Rows with no
 * mass sink to the bottom in `mass` order (they contribute 0) but keep their
 * place in `name` order. Pure — the caller reads each link's stored `<inertial>`.
 */
export function summariseMass(entries: MassRow[], sort: MassSort = 'mass'): MassBreakdown {
  const rows = [...entries]
  if (sort === 'name') {
    rows.sort((a, b) => a.link.localeCompare(b.link))
  } else {
    rows.sort((a, b) => b.grams - a.grams || a.link.localeCompare(b.link))
  }
  const totalG = rows.reduce((sum, r) => sum + (r.grams > 0 ? r.grams : 0), 0)
  const unsetCount = rows.reduce((n, r) => n + (r.grams > 0 ? 0 : 1), 0)
  return { rows, totalG, unsetCount }
}

/** A short human label for a mass source, for the inspector's provenance chip. */
export function sourceLabel(source: MassSource): string {
  switch (source) {
    case 'measured':
      return 'measured'
    case 'library':
      return 'from part'
    case 'estimated':
      return 'estimated'
    case 'none':
      return 'not set'
  }
}
