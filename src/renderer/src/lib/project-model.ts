/**
 * What a Snakie PROJECT is, in one place — the project switcher's model.
 * =============================================================================
 *
 * A project is a folder. Its `robot.yml` holds the board, the parts and the
 * wiring (Electronics) and names the robot model (`robot.urdf`, Build); its code
 * and 3D-printable files sit beside it — by convention in `code/` and `stl/`
 * (the KRF layout, `shared/krf.ts`). Nothing used to say any of this on screen,
 * and with no folder open Electronics and Build quietly saved to a hidden
 * scratch `robot.yml` (app data on desktop, browser storage on the web), which
 * looked like a project loading itself from nowhere.
 *
 * The switcher shows it instead: which project is open, where it lives, what is
 * in it, and — with no folder — that the scratch work is NOT saved yet. These
 * helpers are pure (no DOM / fs) so the rules are unit-tested; the component
 * does the I/O.
 */
import { blankRobot, type RobotDefinition } from '../../../shared/robot'
import { KRF_VERSION } from '../../../shared/krf'
import { blankUrdf } from '../components/robot-assembly'

/** The folder's last path segment — what a project is called when its
 *  `robot.yml` doesn't name it. */
export function folderName(folder: string): string {
  const parts = String(folder ?? '')
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
  return parts[parts.length - 1] || folder
}

/** A folder path shortened for display: the home directory becomes `~`. */
export function displayPath(folder: string): string {
  return String(folder ?? '')
    .replace(/[/\\]+$/, '')
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~')
}

/** A project name turned into a folder name: lower case, dashes, no
 *  characters any file system objects to. Empty when nothing usable is left. */
export function projectSlug(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** One directory listing, as the summary needs it. */
export interface ListedEntry {
  name: string
  isDir: boolean
}

/** What is in a project, for the switcher's "In this project" rows. */
export interface ProjectSummary {
  /** The name to show: `robot.yml`'s `name`, else the folder's. */
  name: string
  /** Code files, relative to the project (`code/main.py`, `main.py`). */
  code: string[]
  /** Parts placed in Electronics (the board itself not counted). */
  parts: number
  /** Wires drawn in Electronics. */
  wires: number
  /** The board id, when one is chosen. */
  board?: string
  /** The robot model `robot.yml` links, relative to the project. */
  model?: string
  /** 3D-printable files, relative to the project. */
  print: string[]
}

const CODE_RE = /\.py$/i
const PRINT_RE = /\.(stl|3mf|obj)$/i

/**
 * Summarise a project from its `robot.yml` and the listings of its root and
 * its conventional `code/` and `stl/` folders (either may be missing).
 */
export function summariseProject(input: {
  folder: string
  robot: RobotDefinition | null
  root: ListedEntry[]
  code?: ListedEntry[]
  stl?: ListedEntry[]
}): ProjectSummary {
  const files = (list: ListedEntry[] | undefined, prefix: string, re: RegExp): string[] =>
    (list ?? []).filter((e) => !e.isDir && re.test(e.name)).map((e) => prefix + e.name)
  const robot = input.robot
  return {
    name: robot?.name?.trim() || folderName(input.folder),
    code: [...files(input.code, 'code/', CODE_RE), ...files(input.root, '', CODE_RE)],
    parts: robot?.parts?.length ?? 0,
    wires: robot?.connections?.length ?? 0,
    board: robot?.board || undefined,
    model: robot?.robot?.urdf || undefined,
    print: [...files(input.stl, 'stl/', PRINT_RE), ...files(input.root, '', PRINT_RE)]
  }
}

/** "3 parts, 4 wires" — what Electronics holds, in words. */
export function electronicsLine(s: Pick<ProjectSummary, 'parts' | 'wires' | 'board'>): string {
  if (!s.parts && !s.wires) return s.board ? 'Board chosen, nothing wired yet' : 'Nothing wired yet'
  const n = (k: number, one: string): string => `${k} ${one}${k === 1 ? '' : 's'}`
  return s.wires ? `${n(s.parts, 'part')}, ${n(s.wires, 'wire')}` : n(s.parts, 'part')
}

/** A short list of file names: `main.py, sweep.py` or `main.py +3 more`. */
export function filesLine(paths: string[], max = 2): string {
  const names = paths.map((p) => p.slice(p.lastIndexOf('/') + 1))
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`
}

/**
 * Is there anything in the scratch (no-folder) `robot.yml` worth saving? An
 * empty one is just "no project open"; one with parts, wires, a board or a name
 * is work that is NOT saved to a folder yet, and the switcher says so.
 */
export function scratchHasWork(robot: RobotDefinition | null): boolean {
  if (!robot) return false
  return (
    (robot.parts?.length ?? 0) > 0 ||
    (robot.connections?.length ?? 0) > 0 ||
    !!robot.board ||
    !!robot.name?.trim()
  )
}

/** What a new project starts with. */
export type ProjectTemplate = 'code' | 'robot'

/** One file a new project writes, relative to the project folder. */
export interface PlannedFile {
  path: string
  content: string
}

/** Everything New Project writes. */
export interface ProjectPlan {
  /** The `robot.yml` to save (through `robot.save`, so both hosts serialise it
   *  the same way). */
  robot: RobotDefinition
  /** The other files. */
  files: PlannedFile[]
  /** The file to open in the editor afterwards, relative to the project. */
  entry: string
}

/** The starter program a new project opens on. */
export function starterCode(name: string): string {
  return [
    `# ${name}`,
    '#',
    '# Press Run to try it. No board? It runs on the simulated one.',
    '',
    'from machine import Pin',
    'from time import sleep',
    '',
    'led = Pin("LED", Pin.OUT)',
    '',
    'while True:',
    '    led.toggle()',
    '    sleep(0.5)',
    ''
  ].join('\n')
}

/**
 * Plan a new project. "Just code" is a `main.py` and a `robot.yml` naming the
 * project (so Electronics has somewhere to save the moment a part is added);
 * "Robot" is the KRF layout — `code/`, `urdf/` with a starter model already
 * linked so Build opens on it, and an empty `stl/` for print files.
 *
 * `scratch` carries the unsaved no-folder work into the new project (Save as
 * project): its board, parts and wiring are kept, its name replaced.
 */
export function planProject(
  name: string,
  template: ProjectTemplate,
  scratch?: RobotDefinition | null
): ProjectPlan {
  const clean = name.trim() || 'My robot'
  const base: RobotDefinition = { ...blankRobot(), ...(scratch ?? {}), name: clean }
  if (template === 'code') {
    return { robot: base, files: [{ path: 'main.py', content: starterCode(clean) }], entry: 'main.py' }
  }
  const urdf = 'urdf/robot.urdf'
  return {
    robot: {
      ...base,
      robot: {
        ...(base.robot ?? {}),
        version: KRF_VERSION,
        urdf: base.robot?.urdf || urdf
      }
    },
    files: [
      { path: 'code/main.py', content: starterCode(clean) },
      { path: urdf, content: blankUrdf(projectSlug(clean).replace(/-/g, '_') || 'my_robot') },
      { path: 'stl/README.txt', content: PRINT_README }
    ],
    entry: 'code/main.py'
  }
}

/** Left in `stl/` so the folder exists (git and some file systems drop empty
 *  ones) and says what it is for. */
export const PRINT_README =
  'Put your robot\'s 3D-printable files (.stl, .3mf) here.\n' +
  'Export them from BetterCAD, or drop in files from anywhere.\n' +
  'Snakie lists them under "Print files" in the project menu.\n'
