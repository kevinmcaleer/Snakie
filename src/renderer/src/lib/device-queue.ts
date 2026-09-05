/**
 * ONE QUEUE FOR EVERY DEVICE FILE OPERATION (#837).
 *
 * The device layer already serialises the WIRE: `opQueue` makes each `exec`
 * atomic and `withFsLock` makes a whole file-write sequence atomic (#850), so
 * two writes can no longer shred each other. What it does not do is stop two
 * OPERATIONS being started at once — and Snakie routinely offers several at the
 * same moment: the instruments-library banner, the missing-library banner, the
 * Board View's driver banner and the Modules panel can all be on screen for one
 * freshly-connected board. Accepting two of them used to start two installs that
 * interleaved their round trips, each reporting progress over the other, taking
 * turns at the port and finishing in an order nobody asked for.
 *
 * So operations queue HERE, one level above the wire: the first one runs, the
 * rest wait their turn, and the whole lot is described by a single snapshot the
 * modal renders. Serialising at the wire keeps files intact; serialising here is
 * what makes the app tell the truth about what the board is doing.
 *
 * Three properties are worth stating, because each of them is a bug we hit:
 *
 *  - **Dedupe by key.** Two banners can want the same driver. Enqueuing a key
 *    that is already waiting or running JOINS that task rather than installing
 *    the same module twice.
 *  - **Cancel releases the user immediately.** A wedged board cannot be made to
 *    return, so cancelling detaches the UI from the running task (its caller's
 *    promise rejects, the modal goes away) instead of waiting for something that
 *    may never happen. The internal chain still awaits the abandoned task before
 *    starting the next one, so a later operation cannot overlap it — it simply
 *    shows as waiting, which is the truth.
 *  - **No nesting.** A task's `run` must not enqueue another task: it would wait
 *    for the queue it is itself holding. Enqueue at the top of a user action,
 *    and call the device directly inside it.
 */

import type { TransferRow } from '../components/TransferProgressDialog'

/** Where one queued operation is. `cancelled` is terminal, like `error`. */
export type DeviceTaskState = 'waiting' | 'running' | 'done' | 'error' | 'cancelled'

/** Where one of a task's own sub-steps is (the per-file ticks of a folder copy). */
export type DeviceStepState = 'pending' | 'running' | 'done' | 'error'

/** One sub-step of a task — a single file in a folder copy, say. */
export interface DeviceStep {
  label: string
  state: DeviceStepState
  error?: string
}

/** The read-only view of a queued task that the modal renders. */
export interface DeviceTaskView {
  id: number
  key: string
  label: string
  state: DeviceTaskState
  error?: string
  steps: readonly DeviceStep[]
}

/** Everything the modal needs, rebuilt on each change so its identity is stable. */
export interface DeviceQueueSnapshot {
  tasks: readonly DeviceTaskView[]
  /** True while anything is running OR waiting — i.e. the board is busy. */
  busy: boolean
  /** The first failure still on the list; keeps the modal open. */
  error: string | null
}

/** What a task's `run` is handed so it can report progress and notice a cancel. */
export interface DeviceTaskContext {
  /** True once the user cancelled — a long task must check it between steps. */
  readonly cancelled: boolean
  /** Declare the steps this task will work through, in order. */
  setSteps(labels: readonly string[]): void
  /** Move one step on. Out-of-range indexes are ignored. */
  step(index: number, state: DeviceStepState, error?: string): void
}

/** A unit of work that touches the board's filesystem. */
export interface DeviceTask<T> {
  /** Identity for dedupe: `module:vl53l0x`, `folder:/home/kev/lib`, … */
  key: string
  /** What the modal calls it: "Installing VL53L0X". */
  label: string
  run(ctx: DeviceTaskContext): Promise<T>
}

/** Thrown into a caller whose task was cancelled or dropped from the queue. */
export class DeviceOperationCancelled extends Error {
  constructor(label: string) {
    super(`${label} was cancelled.`)
    this.name = 'DeviceOperationCancelled'
  }
}

interface Entry<T = unknown> {
  id: number
  key: string
  label: string
  state: DeviceTaskState
  error?: string
  steps: DeviceStep[]
  task: DeviceTask<T>
  /** Raised by a cancel; read through `ctx.cancelled`. */
  cancelled: boolean
  /** Guards the caller's promise against being settled twice. */
  settled: boolean
  resolve: (value: T) => void
  reject: (err: unknown) => void
  promise: Promise<T>
}

let nextId = 1
let entries: Entry[] = []
/** The serialisation chain — every task is appended to it, so they run in turn. */
let chain: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()

let snapshot: DeviceQueueSnapshot = { tasks: [], busy: false, error: null }

function view(entry: Entry): DeviceTaskView {
  return {
    id: entry.id,
    key: entry.key,
    label: entry.label,
    state: entry.state,
    error: entry.error,
    steps: entry.steps
  }
}

function emit(): void {
  snapshot = {
    tasks: entries.map(view),
    busy: entries.some((e) => e.state === 'running' || e.state === 'waiting'),
    error: entries.find((e) => e.state === 'error')?.error ?? null
  }
  for (const l of listeners) l()
}

/** Settle the caller's promise exactly once, whatever else happens to the entry. */
function settle(entry: Entry, ok: boolean, value: unknown): void {
  if (entry.settled) return
  entry.settled = true
  if (ok) entry.resolve(value)
  else entry.reject(value)
}

async function runEntry(entry: Entry): Promise<void> {
  // Cancelled while it sat in the queue — never touch the board for it.
  if (entry.state !== 'waiting') return
  entry.state = 'running'
  emit()

  const ctx: DeviceTaskContext = {
    get cancelled(): boolean {
      return entry.cancelled
    },
    setSteps(labels): void {
      entry.steps = labels.map((label) => ({ label, state: 'pending' as const }))
      emit()
    },
    step(index, state, error): void {
      if (index < 0 || index >= entry.steps.length) return
      entry.steps = entry.steps.map((s, i) => (i === index ? { ...s, state, error } : s))
      emit()
    }
  }

  try {
    const value = await entry.task.run(ctx)
    // A cancel already settled the caller and took the row off the list; the
    // board finishing afterwards changes nothing the user can still see.
    if (entry.cancelled) return
    entry.state = 'done'
    settle(entry, true, value)
  } catch (err) {
    if (entry.cancelled) return
    entry.state = 'error'
    entry.error = err instanceof Error ? err.message : String(err)
    settle(entry, false, err)
  } finally {
    emit()
  }
}

/**
 * Put one device operation in the queue and get its result back.
 *
 * Resolves with whatever `run` returned, rejects with whatever it threw — so a
 * call site keeps the try/catch it already had. A cancelled task rejects with
 * {@link DeviceOperationCancelled}.
 */
export function enqueueDeviceTask<T>(task: DeviceTask<T>): Promise<T> {
  const pending = entries.find(
    (e) => e.key === task.key && (e.state === 'waiting' || e.state === 'running')
  )
  // Two banners can offer the same driver. The second click should watch the
  // first install, not start a second one behind it.
  if (pending) return pending.promise as Promise<T>

  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  const entry: Entry<T> = {
    id: nextId++,
    key: task.key,
    label: task.label,
    state: 'waiting',
    steps: [],
    task,
    cancelled: false,
    settled: false,
    resolve,
    reject,
    promise
  }
  entries = [...entries, entry as Entry]
  emit()
  chain = chain.then(() => runEntry(entry as Entry))
  return promise
}

/**
 * Stop everything and hand the app back to the user.
 *
 * Waiting tasks are dropped outright. The running one is asked to stop (it sees
 * `ctx.cancelled`) and then ABANDONED: its caller is rejected and its row taken
 * off the list right away, because a board that has stopped answering will not
 * start answering just because we waited longer. The chain still holds until it
 * really settles, so nothing new can overlap it.
 */
export function cancelDeviceQueue(): void {
  for (const entry of entries) {
    if (entry.state !== 'waiting' && entry.state !== 'running') continue
    entry.cancelled = true
    entry.state = 'cancelled'
    settle(entry, false, new DeviceOperationCancelled(entry.label))
  }
  entries = []
  emit()
}

/** Clear the finished rows (the modal's Close). Anything still live stays. */
export function dismissDeviceQueue(): void {
  entries = entries.filter((e) => e.state === 'waiting' || e.state === 'running')
  emit()
}

/** Subscribe to queue changes (for `useSyncExternalStore`). */
export function subscribeDeviceQueue(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current snapshot; its identity only changes when the queue does. */
export function getDeviceQueueSnapshot(): DeviceQueueSnapshot {
  return snapshot
}

/** Test seam — empty the queue and drop the chain, listeners intact. */
export function resetDeviceQueueForTest(): void {
  entries = []
  chain = Promise.resolve()
  emit()
}

// --- The view the modal renders ---------------------------------------------

/** A task's row state, in the dialog's vocabulary. A cancelled task reads as a
 *  failure because that is what it is: work that did not happen. */
function taskRowState(state: DeviceTaskState): TransferRow['state'] {
  if (state === 'running') return 'copying'
  if (state === 'done') return 'done'
  if (state === 'error' || state === 'cancelled') return 'error'
  return 'pending'
}

function stepRowState(state: DeviceStepState): TransferRow['state'] {
  return state === 'running' ? 'copying' : state
}

/**
 * Flatten the queue into the dialog's rows: one row per task, with its own steps
 * listed indented underneath. Pure.
 *
 * A task keeps its step rows after it finishes — a folder copy that collapsed
 * back to a single line the moment it succeeded would throw away the receipt
 * the user was reading.
 */
export function queueRows(tasks: readonly DeviceTaskView[]): TransferRow[] {
  const rows: TransferRow[] = []
  for (const task of tasks) {
    rows.push({
      id: `task-${task.id}`,
      label: task.label,
      state: taskRowState(task.state),
      error: task.error
    })
    task.steps.forEach((step, i) => {
      rows.push({
        id: `task-${task.id}-step-${i}`,
        label: step.label,
        state: stepRowState(step.state),
        error: step.error,
        indent: true
      })
    })
  }
  return rows
}

/**
 * How far through the queue we are, counting LEAVES: a task with steps is
 * counted by its steps, one without by itself. Counting both would make a
 * twelve-file copy report thirteen things to do. Pure.
 */
export function queueProgress(tasks: readonly DeviceTaskView[]): {
  done: number
  total: number
} {
  let done = 0
  let total = 0
  for (const task of tasks) {
    if (task.steps.length > 0) {
      total += task.steps.length
      done += task.steps.filter((s) => s.state === 'done').length
    } else {
      total += 1
      if (task.state === 'done') done += 1
    }
  }
  return { done, total }
}

/** The dialog heading: one operation names itself, several get a count. Pure. */
export function queueTitle(tasks: readonly DeviceTaskView[]): string {
  if (tasks.length === 1) return tasks[0].label
  return `Working on the board — ${tasks.length} operations`
}

/**
 * Should the modal stay out of the way after the user pushed it aside (#889)?
 *
 * Dismissing used to mean "clear the finished rows", which did nothing while
 * work was still running — the modal simply stayed up, and a five-minute folder
 * copy held the app hostage. The user asked to be able to close it and carry on,
 * with the status bar keeping the board's activity visible.
 *
 * So a dismissal is remembered as the highest task id it covered, and it lapses
 * on its own two ways: NEW work re-opens the modal (the user pushed aside the
 * copy they knew about, not the install they have not seen yet), and a FAILURE
 * always re-opens it, because an error nobody saw did not happen.
 */
export function stayHidden(
  snap: DeviceQueueSnapshot,
  hiddenThroughId: number | null
): boolean {
  if (hiddenThroughId === null) return false
  if (snap.error) return false
  return !snap.tasks.some((t) => t.id > hiddenThroughId)
}

/** The highest task id currently on the queue — what a dismissal covers. */
export function highestTaskId(tasks: readonly DeviceTaskView[]): number | null {
  let top: number | null = null
  for (const t of tasks) if (top === null || t.id > top) top = t.id
  return top
}

/**
 * What the modal should do about the current snapshot, given whether it is
 * already on screen. Pure, so the timing rules are testable without a DOM.
 *
 *  - `hide`  — nothing queued.
 *  - `show`  — put it up (or keep it up).
 *  - `arm`   — work is running but has not been on screen yet: start the reveal
 *              delay. Most installs finish in well under it, and flashing a
 *              modal up and straight back down for a one-file write is worse
 *              than saying nothing at all.
 *  - `clear` — everything finished before the delay elapsed, so nobody ever saw
 *              the dialog; drop the finished rows rather than leaving them to
 *              appear in front of the NEXT operation.
 */
export type QueueDialogAction = 'hide' | 'show' | 'arm' | 'clear'

export function queueDialogAction(
  snap: DeviceQueueSnapshot,
  onScreen: boolean
): QueueDialogAction {
  if (snap.tasks.length === 0) return 'hide'
  // A failure always surfaces, however quick it was — an error the user never
  // saw is an error that did not happen, as far as they are concerned.
  if (snap.error) return 'show'
  if (snap.busy) return onScreen ? 'show' : 'arm'
  return onScreen ? 'show' : 'clear'
}
