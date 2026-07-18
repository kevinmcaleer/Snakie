import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { createWebRobotApi, type WebRobotFs } from '../src/renderer/src/web/web-robot'
import type { RobotDefinition } from '../src/shared/robot'

// The suite runs in a plain node environment; web-robot only touches `window`
// inside its methods (localStorage + the file picker), so a tiny shim suffices.
beforeAll(() => {
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      clear: () => store.clear()
    }
  }
})

/**
 * The WEB robot.yml backend (epic #267) — robot.load/save over the web
 * filesystem using the SAME shared YAML pipeline as the desktop. This is what
 * lets a project's servo↔joint bindings load in the browser (and therefore what
 * lets SNK SERVO telemetry from the WASM sim animate the 3-D robot).
 */

type RobotApi = {
  load(folder?: string): Promise<RobotDefinition>
  save(folder: string | undefined, def: RobotDefinition): Promise<{ ok: boolean; error?: string }>
  importMesh(urdfPath: string, src?: string): Promise<{ cancelled?: boolean; error?: string; rel?: string; name?: string }>
  onChanged(cb: () => void): () => void
}

/** In-memory WebRobotFs — text + binary files keyed by path. */
const memFs = (): WebRobotFs & { files: Map<string, string | Uint8Array> } => {
  const files = new Map<string, string | Uint8Array>()
  return {
    files,
    readFile: async (p) => {
      const f = files.get(p)
      if (typeof f !== 'string') throw new Error(`missing: ${p}`)
      return f
    },
    writeFile: async (p, c) => void files.set(p, c),
    writeFileBytes: async (p, b) => void files.set(p, b),
    stat: async (p) => {
      if (!files.has(p)) throw new Error(`missing: ${p}`)
      return { isDir: false }
    },
    mkdir: async () => undefined
  }
}

const BUDDY_YML = [
  'parts:',
  '  - id: servo-1',
  '    lib: snakie-standard',
  '    part: sg90',
  'connections: []',
  'robot:',
  '  version: 1',
  '  urdf: robot.urdf',
  '  servoJointMap:',
  '    - pin: "0"',
  '      joint: shoulder_joint',
  '      servoMin: 0',
  '      servoMax: 180',
  '      jointMin: -90',
  '      jointMax: 90',
  ''
].join('\n')

describe('createWebRobotApi', () => {
  beforeEach(() => (window as unknown as { localStorage: { clear(): void } }).localStorage.clear())

  it('loads <folder>/robot.yml through the shared YAML pipeline (bindings survive)', async () => {
    const fs = memFs()
    fs.files.set('buddyjr/robot.yml', BUDDY_YML)
    const api = createWebRobotApi(fs) as unknown as RobotApi
    const def = await api.load('buddyjr')
    expect(def.parts).toHaveLength(1)
    expect(def.robot?.urdf).toBe('robot.urdf')
    expect(def.robot?.servoJointMap?.[0]).toMatchObject({ pin: '0', joint: 'shoulder_joint' })
  })

  it('returns a blank definition when robot.yml is missing (like the desktop)', async () => {
    const api = createWebRobotApi(memFs()) as unknown as RobotApi
    expect(await api.load('nowhere')).toEqual({ parts: [], connections: [] })
  })

  it('save → load round-trips through robotToYaml/robotFromYaml', async () => {
    const fs = memFs()
    const api = createWebRobotApi(fs) as unknown as RobotApi
    const def: RobotDefinition = {
      parts: [],
      connections: [],
      robot: {
        version: 1,
        urdf: 'robot.urdf',
        servoJointMap: [
          { pin: '2', joint: 'arm_joint', servoMin: 0, servoMax: 180, jointMin: -90, jointMax: 90 }
        ]
      }
    }
    expect(await api.save('bot', def)).toEqual({ ok: true })
    expect(typeof fs.files.get('bot/robot.yml')).toBe('string')
    const back = await api.load('bot')
    expect(back.robot?.servoJointMap?.[0]).toMatchObject({ pin: '2', joint: 'arm_joint' })
  })

  it('falls back to localStorage when no folder is open (web twin of userData)', async () => {
    const api = createWebRobotApi(memFs()) as unknown as RobotApi
    const def: RobotDefinition = { parts: [], connections: [], robot: { version: 1, urdf: 'a.urdf' } }
    expect(await api.save(undefined, def)).toEqual({ ok: true })
    const back = await api.load(undefined)
    expect(back.robot?.urdf).toBe('a.urdf')
  })

  it('reports save failures honestly (no false "saved ✓")', async () => {
    const fs = memFs()
    fs.writeFile = async () => {
      throw new Error('disk says no')
    }
    const api = createWebRobotApi(fs) as unknown as RobotApi
    const res = await api.save('bot', { parts: [], connections: [] })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('disk says no')
  })

  it('importMesh copies picked bytes into <urdf-dir>/meshes with a collision-safe name', async () => {
    const fs = memFs()
    fs.files.set('bot/meshes/arm.stl', new Uint8Array([1])) // existing → forces -1 suffix
    // Duck-typed picked file — web-robot only calls getFile().arrayBuffer().
    const picked = {
      name: 'arm.stl',
      getFile: async () => ({ arrayBuffer: async () => new Uint8Array([9, 9]).buffer })
    }
    const w = window as unknown as { showOpenFilePicker?: unknown }
    w.showOpenFilePicker = async () => [picked]
    const api = createWebRobotApi(fs) as unknown as RobotApi
    const res = await api.importMesh('bot/robot.urdf')
    expect(res).toMatchObject({ rel: 'meshes/arm-1.stl', name: 'arm-1.stl' })
    expect(fs.files.get('bot/meshes/arm-1.stl')).toBeInstanceOf(Uint8Array)
    delete w.showOpenFilePicker
  })

  it('importMesh with an Electron src path fails gracefully in the browser', async () => {
    const api = createWebRobotApi(memFs()) as unknown as RobotApi
    const res = await api.importMesh('bot/robot.urdf', '/abs/path/mesh.stl')
    expect(res.error).toBeTruthy()
  })
})
