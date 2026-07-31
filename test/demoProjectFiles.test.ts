import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DEMO_ENTRY_FILE,
  DEMO_FILES,
  DEMO_FOLDER,
  demoInstallPlan,
  joinPath
} from '../src/renderer/src/lib/demo-project'

const SRC = join(__dirname, '..', 'examples', 'servo-arm')

describe('the inlined demo project', () => {
  it('actually inlined the files — a silently-empty glob would ship a no-op button', () => {
    expect(Object.keys(DEMO_FILES).sort()).toEqual(['arm.urdf', 'robot.yml', 'sweep.py'])
  })

  it('is byte-identical to examples/servo-arm — ONE source of truth', () => {
    // A bundled duplicate would drift from the copy demoProject.test.ts guards,
    // and the demo would quietly stop being coherent.
    for (const [name, content] of Object.entries(DEMO_FILES)) {
      expect(content, name).toBe(readFileSync(join(SRC, name), 'utf-8'))
    }
  })

  it('opens on a file that exists in the project', () => {
    expect(DEMO_FILES[DEMO_ENTRY_FILE]).toBeTruthy()
  })

  it('carries the wiring, not just the model', () => {
    // The whole point: Electronics must have something to show.
    expect(DEMO_FILES['robot.yml']).toContain('board: pico')
    expect(DEMO_FILES['robot.yml']).toContain('connections:')
    expect(DEMO_FILES['robot.yml']).not.toContain('connections: []')
  })
})

describe('demoInstallPlan', () => {
  it('writes every file into a named subfolder of the destination', () => {
    const plan = demoInstallPlan('/home/kev/projects')
    expect(plan).toHaveLength(3)
    for (const f of plan) expect(f.path.startsWith(`/home/kev/projects/${DEMO_FOLDER}/`)).toBe(true)
    expect(plan.map((f) => f.path.split('/').pop()).sort()).toEqual([
      'arm.urdf',
      'robot.yml',
      'sweep.py'
    ])
  })

  it('carries the real contents, not placeholders', () => {
    const robot = demoInstallPlan('/x').find((f) => f.path.endsWith('robot.yml'))
    expect(robot?.content).toBe(DEMO_FILES['robot.yml'])
  })

  it('tolerates a trailing slash on the destination', () => {
    expect(joinPath('/a/b/', 'c')).toBe('/a/b/c')
    expect(joinPath('/a/b', 'c')).toBe('/a/b/c')
    expect(demoInstallPlan('/a/b/')[0].path.startsWith('/a/b/servo-arm/')).toBe(true)
  })
})
