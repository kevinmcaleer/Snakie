/**
 * Pure UI-state logic for the Modules manager (#120) — kept free of React /
 * Electron so it can be unit-tested in isolation (mirrors `instrumentsLib.ts`).
 *
 * The Modules manager shows the module catalog grouped by instrument, each
 * module marked INSTALLED / AVAILABLE / INSTALLING / ERROR. The "is it on the
 * board?" truth comes from a device IMPORT probe (the set of import-names that
 * imported); the per-click install transitions are tracked separately. This file
 * owns how those two sources COMBINE into the single per-module display status
 * the rows render, plus the installed/available counts for the section headers.
 */

import {
  diffInstalled,
  type ModuleDef,
  type ModuleStatus
} from '../../../shared/modules-catalog'

/**
 * The transient per-module install transition tracked while a click is in
 * flight, keyed by catalog id. Absent ⇒ no install attempted this session.
 */
export interface ModuleInstallUiState {
  /** Where the click is: writing/installing, done, or failed. */
  status: 'installing' | 'done' | 'error'
  /** The cleaned device log / error text to show under the row. */
  log: string
  /** Non-fatal notes (provenance / mip hints). */
  notes: string[]
}

/**
 * The display status a Modules-manager row renders. Extends the catalog's
 * {@link ModuleStatus} (`installed`/`available`/`unknown`) with the live click
 * transitions (`installing`/`error`) so the row can show a spinner / RETRY.
 */
export type ModuleRowStatus = ModuleStatus | 'installing' | 'error'

/**
 * Combine the probe-derived status with any in-flight install transition into
 * the single status a row renders. Precedence (highest first):
 *   1. `installing`  — a click is in flight (spinner), regardless of the probe.
 *   2. `installed`   — the probe says it's importable, OR this session installed
 *      it successfully (`done`) — so a just-installed module reads as INSTALLED
 *      even before the next probe runs.
 *   3. `error`       — the last click failed and the probe doesn't (yet) show it.
 *   4. the probe status (`available` / `unknown`).
 * Pure.
 */
export function rowStatus(
  probe: ModuleStatus,
  ui: ModuleInstallUiState | undefined
): ModuleRowStatus {
  if (ui?.status === 'installing') return 'installing'
  if (probe === 'installed' || ui?.status === 'done') return 'installed'
  if (ui?.status === 'error') return 'error'
  return probe
}

/**
 * Build the full id → row-status map for the catalog from the probe set + the
 * in-flight install-UI map. `installedImportNames` is the probe result (the
 * subset of import-names found importable); `connected` gates the probe (false ⇒
 * every probe status is `unknown`). Pure; returns a fresh map over exactly the
 * catalog ids — the manager reads it to render each row + the section counts.
 */
export function buildRowStatuses(
  defs: ModuleDef[],
  installedImportNames: ReadonlySet<string>,
  connected: boolean,
  ui: Record<string, ModuleInstallUiState>
): Record<string, ModuleRowStatus> {
  const probe = diffInstalled(installedImportNames, connected, defs)
  const out: Record<string, ModuleRowStatus> = {}
  for (const def of defs) {
    out[def.id] = rowStatus(probe[def.id] ?? 'available', ui[def.id])
  }
  return out
}

/** Installed / available / total counts derived from a row-status map. Pure. */
export interface ModuleCounts {
  installed: number
  available: number
  total: number
}

/**
 * Count how many catalog modules read as installed vs available (anything not
 * `installed` counts toward `available` for the header summary — `installing` /
 * `error` / `unknown` are all "not yet on the board"). Pure.
 */
export function countStatuses(
  defs: ModuleDef[],
  statuses: Record<string, ModuleRowStatus>
): ModuleCounts {
  let installed = 0
  for (const def of defs) {
    if (statuses[def.id] === 'installed') installed++
  }
  return { installed, available: defs.length - installed, total: defs.length }
}

/**
 * The action a row's button should offer for a given status: the visible label
 * and whether it is actionable (a click should kick an install). `installed`
 * shows a non-actionable stamp; `installing` is disabled; `error` retries.
 * Pure — drives the row button without branching in the component.
 */
export function rowAction(status: ModuleRowStatus): { label: string; actionable: boolean } {
  switch (status) {
    case 'installed':
      return { label: 'INSTALLED', actionable: false }
    case 'installing':
      return { label: 'INSTALLING…', actionable: false }
    case 'error':
      return { label: 'RETRY', actionable: true }
    case 'unknown':
      // Not probed (e.g. disconnected): offer install but the caller gates on
      // the connection, so the button is disabled with a hint there.
      return { label: 'INSTALL', actionable: true }
    case 'available':
    default:
      return { label: 'INSTALL', actionable: true }
  }
}
