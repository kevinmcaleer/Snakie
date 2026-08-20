import { CollapsiblePanel } from './CollapsiblePanel'
import {
  countComponents,
  coverageLabel,
  type HierarchyNode,
  type HierarchyWorkspace,
  type MassCoverage
} from './hierarchy-tree'
import type { JointType } from './robot-assembly'
import './HierarchyPanel.css'

/**
 * THE SHARED HIERARCHY PANEL (#718, epic #720) — the ONE component tree, mounted
 * in the Electronics workspace (inside the board browser, in BOTH board hosts)
 * and in the Build workspace (the build dock's Components branch).
 *
 * It replaces two trees that described the same robot differently: the board
 * browser's parts list and the build dock's kinematic chain. Rows come from the
 * pure {@link unifiedTree}; this file is only presentation, so what the two
 * workspaces show can't drift apart — they render the same nodes with the same
 * component.
 *
 * The one thing that DOES differ is what's live: rows that exist only in Build
 * (structural links, joints) render **dimmed and inert** in Electronics rather
 * than being hidden, so the shape of the tree is identical wherever you are
 * (the epic's decision — hiding them made the two trees look different again).
 *
 * Mass badges (#719) hang off these rows: grams when a body is weighed, a "?"
 * when it isn't. Never a substituted default — an unknown mass must LOOK
 * unknown, because the CoM silently leaves it out.
 */

// A pencil enters a row's editor (Build). Matches the build dock's own glyph.
const PENCIL = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M11.5 1.5l3 3L5 14l-3.5.5L2 11z" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
)
// An anchor marks the base link (Fusion-style) — the part everything hangs off.
const ANCHOR = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <circle cx="8" cy="3" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M8 4.8V14M4 8H2.4c0 3 2.4 4.8 5.6 4.8S13.6 11 13.6 8H12M4.8 10.2L8 13l3.2-2.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
const MESH_ICON = (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <path d="M8 2.2l5.6 9.6H2.4z M8 2.2v9.6 M4.9 8.6h6.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
)
const CUBE_ICON = (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <path
      d="M8 2.3l5.4 3.1v5.2L8 13.7 2.6 10.6V5.4z M2.6 5.4L8 8.5l5.4-3.1 M8 8.5v5.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
)
// A chip marks a row with NO 3-D body yet (the Sync dialog's "Add to Build").
const GHOST_ICON = (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <path
      d="M8 2.3l5.4 3.1v5.2L8 13.7 2.6 10.6V5.4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeDasharray="2 1.6"
      strokeLinejoin="round"
    />
  </svg>
)

/** A distinct glyph per joint type: a lock (fixed), a rotation arrow (hinge), a
 *  spoked wheel (continuous) and a slider track (prismatic). */
const JOINT_ICONS: Record<JointType, JSX.Element> = {
  fixed: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M5 7V5.2a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3.6" y="7" width="8.8" height="6" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  revolute: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M12.6 8a4.6 4.6 0 1 1-1.5-3.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12.7 3.2v2.4h-2.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  continuous: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.8v2M8 11.2v2M2.8 8h2M11.2 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  prismatic: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M3 8h10M4.6 5.8v4.4M11.4 5.8v4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="6.5" y="5.9" width="3" height="4.2" rx="0.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

const BIN_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7m4 4v6m4-6v6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Kid-friendly label for a joint type (matches the joint editor's chips). */
export function jointTypeLabel(type: JointType): string {
  switch (type) {
    case 'fixed':
      return 'Fixed'
    case 'revolute':
      return 'Hinge'
    case 'continuous':
      return 'Wheel'
    case 'prismatic':
      return 'Slider'
    default:
      return type
  }
}

/** Grams for a badge: fine-grained under 10 g, whole grams above (a 0.1 g
 *  wobble on a 300 g battery is noise, on a 2 g header it's the whole number). */
export function formatGrams(g: number): string {
  return g < 10 ? `${Math.round(g * 10) / 10} g` : `${Math.round(g)} g`
}

export interface HierarchyPanelProps {
  /** Rows from {@link unifiedTree} — the same list in both workspaces. */
  nodes: HierarchyNode[]
  /** Where it's mounted. Decides what is INERT, never what exists. */
  workspace: HierarchyWorkspace
  /** The shared selection key (survives a workspace switch). */
  selectedKey: string | null
  /** Click a row: select it + zoom-fit it in the CURRENT workspace. */
  onSelect: (node: HierarchyNode) => void
  /** Whether the Components branch is expanded. */
  open: boolean
  onToggleOpen: () => void
  /** The row whose properties dialog is open (highlighted). */
  activeKey?: string | null
  /** Open a row's editor (the pencil). Omit to hide the pencil column. */
  onEdit?: (node: HierarchyNode) => void
  /** Right-click a row (rename / make base / delete). */
  onContextMenu?: (e: React.MouseEvent, node: HierarchyNode) => void
  /** Remove a placed component (the board browser's bin). */
  onRemove?: (node: HierarchyNode) => void
  /** Mass coverage readout under the tree (#719). Omit to hide it. */
  coverage?: MassCoverage | null
  /** Shown in place of the tree when there is nothing yet. */
  emptyHint?: string
}

export function HierarchyPanel({
  nodes,
  workspace,
  selectedKey,
  onSelect,
  open,
  onToggleOpen,
  activeKey,
  onEdit,
  onContextMenu,
  onRemove,
  coverage,
  emptyHint
}: HierarchyPanelProps): JSX.Element {
  const label = coverage ? coverageLabel(coverage) : null
  return (
    <div className={`uhier uhier--${workspace}`}>
      <CollapsiblePanel
        title="Components"
        open={open}
        onToggle={onToggleOpen}
        badge={countComponents(nodes)}
        className="uhier__section"
        bodyClassName="uhier__section-body"
      >
        {nodes.length === 0 ? (
          <p className="uhier__empty">{emptyHint ?? 'Nothing here yet.'}</p>
        ) : (
          <HierarchyRows
            nodes={nodes}
            depth={0}
            workspace={workspace}
            selectedKey={selectedKey}
            activeKey={activeKey}
            onSelect={onSelect}
            onEdit={onEdit}
            onContextMenu={onContextMenu}
            onRemove={onRemove}
          />
        )}
      </CollapsiblePanel>
      {label && (
        <p
          className={`uhier__coverage${coverage && !coverage.complete ? ' is-partial' : ''}`}
          title={
            coverage && !coverage.complete
              ? 'The centre of mass is computed from the weighed parts only — the rest are left out, not guessed.'
              : 'Every part has a known mass.'
          }
        >
          {label}
        </p>
      )}
    </div>
  )
}

interface RowContext {
  workspace: HierarchyWorkspace
  selectedKey: string | null
  activeKey?: string | null
  onSelect: (node: HierarchyNode) => void
  onEdit?: (node: HierarchyNode) => void
  onContextMenu?: (e: React.MouseEvent, node: HierarchyNode) => void
  onRemove?: (node: HierarchyNode) => void
}

/** One level of the tree — recursive, so a docked part / a jointed child renders
 *  indented beneath its parent with a guide line. */
function HierarchyRows({
  nodes,
  depth,
  ...ctx
}: RowContext & { nodes: HierarchyNode[]; depth: number }): JSX.Element {
  return (
    <ul className={`uhier__list${depth > 0 ? ' uhier__list--nested' : ''}`}>
      {nodes.map((node) => (
        <li key={node.key} className="uhier__item">
          <Row node={node} {...ctx} />
          {node.children.length > 0 && <HierarchyRows nodes={node.children} depth={depth + 1} {...ctx} />}
        </li>
      ))}
    </ul>
  )
}

/** The row's title text — says what it is, what it weighs and what a click does. */
function rowTitle(node: HierarchyNode, inert: boolean): string {
  if (node.kind === 'joint' && node.joint) {
    const j = node.joint
    const what = `Joint “${j.name}” · ${jointTypeLabel(j.type)} · ${j.parent} → ${j.child}`
    return inert ? `${what} — lives in the Build workspace` : `${what} — click to edit, right-click to rename`
  }
  const body =
    node.link === null
      ? 'no 3-D body yet — use Sync to add one'
      : `3-D body: ${node.link}`
  const mass = node.massG == null ? 'mass unknown' : `${formatGrams(node.massG)} (${node.massSource})`
  const what = `${node.label} · ${body} · ${mass}`
  return inert ? `${what} — lives in the Build workspace` : `${what} — click to select and zoom to it`
}

function Row({
  node,
  workspace,
  selectedKey,
  activeKey,
  onSelect,
  onEdit,
  onContextMenu,
  onRemove
}: RowContext & { node: HierarchyNode }): JSX.Element {
  // The epic's decision: Build-only rows are DIMMED AND INERT in Electronics —
  // present (so the tree reads identically) but not clickable there, because
  // there is nothing in the board view to select or zoom to.
  const inert = node.buildOnly && workspace === 'electronics'
  const isSelected = selectedKey === node.key
  const isActive = activeKey != null && activeKey === node.key
  const glyph =
    node.kind === 'joint'
      ? JOINT_ICONS[node.joint?.type ?? 'fixed'] ?? JOINT_ICONS.fixed
      : node.link === null
        ? GHOST_ICON
        : node.geometry === 'mesh'
          ? MESH_ICON
          : CUBE_ICON
  const glyphTitle =
    node.kind === 'joint'
      ? jointTypeLabel(node.joint?.type ?? 'fixed')
      : node.link === null
        ? 'No 3-D body yet'
        : node.geometry === 'mesh'
          ? 'Mesh body'
          : 'Stand-in / primitive body'

  return (
    <div
      className={
        `uhier__row uhier__row--${node.kind}` +
        (isSelected ? ' is-selected' : '') +
        (isActive ? ' is-active' : '') +
        (inert ? ' is-inactive' : '') +
        (node.buildOnly ? ' is-buildonly' : '') +
        (node.loose ? ' is-loose' : '')
      }
      aria-current={isSelected ? 'true' : undefined}
      onContextMenu={inert || !onContextMenu ? undefined : (e) => onContextMenu(e, node)}
    >
      <span
        className={`uhier__base${node.isBase ? ' is-base' : ''}`}
        title={node.isBase ? 'The base — everything hangs off it' : undefined}
        aria-hidden={node.isBase ? undefined : true}
      >
        {node.isBase ? ANCHOR : null}
      </span>
      <span className="uhier__glyph" title={glyphTitle} aria-hidden="true">
        {glyph}
      </span>
      {onEdit && (
        <button
          type="button"
          className={`uhier__edit${isActive ? ' is-on' : ''}`}
          disabled={inert}
          onClick={() => onEdit(node)}
          title={isActive ? 'Close properties' : 'Edit properties'}
          aria-label={`Edit ${node.label}`}
        >
          {PENCIL}
        </button>
      )}
      <button
        type="button"
        className="uhier__name"
        disabled={inert}
        aria-disabled={inert || undefined}
        onClick={() => onSelect(node)}
        onContextMenu={inert || !onContextMenu ? undefined : (e) => onContextMenu(e, node)}
        title={rowTitle(node, inert)}
      >
        <span className="uhier__label">{node.label}</span>
      </button>
      {node.kind === 'joint' ? (
        <span className="uhier__jointtype">{jointTypeLabel(node.joint?.type ?? 'fixed')}</span>
      ) : (
        <MassBadge node={node} />
      )}
      {node.loose && (
        <span className="uhier__loose" title="Not connected to the base — open it and pick a parent">
          ⚠
        </span>
      )}
      {node.kind === 'board' && <span className="uhier__tag">MCU</span>}
      {onRemove && node.kind === 'part' && (
        <button
          type="button"
          className="uhier__del"
          onClick={() => onRemove(node)}
          title={`Remove ${node.label}`}
          aria-label={`Remove ${node.label}`}
        >
          {BIN_ICON}
        </button>
      )}
    </div>
  )
}

/**
 * The per-row mass badge (#719): the grams when the body is weighed, a "?" when
 * it isn't. The "?" is the point — an unknown mass is EXCLUDED from the centre
 * of mass, so it has to be visible rather than quietly defaulted to something.
 */
function MassBadge({ node }: { node: HierarchyNode }): JSX.Element {
  if (node.massG == null) {
    return (
      <span
        className="uhier__mass uhier__mass--unknown"
        title={`${node.label} has no known mass — it is left OUT of the centre of mass. Weigh it in its Properties, or give the library part a mass.`}
      >
        ? g
      </span>
    )
  }
  return (
    <span className="uhier__mass" title={`${formatGrams(node.massG)} — ${node.massSource}`}>
      {formatGrams(node.massG)}
    </span>
  )
}

export default HierarchyPanel
