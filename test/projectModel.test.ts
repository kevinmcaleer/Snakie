import { describe, expect, it } from 'vitest'
import {
  displayPath,
  electronicsLine,
  filesLine,
  folderName,
  planProject,
  projectSlug,
  scratchHasWork,
  summariseProject
} from '../src/renderer/src/lib/project-model'
import { previewTree } from '../src/renderer/src/components/NewProjectDialog'
import { robotFromYaml, robotToYaml } from '../src/shared/robot-yaml'

describe('project model', () => {
  it('names a folder by its last segment, on any platform', () => {
    expect(folderName('/Users/kev/Robots/servo-arm')).toBe('servo-arm')
    expect(folderName('C:\\Robots\\servo-arm\\')).toBe('servo-arm')
    expect(folderName('Projects')).toBe('Projects')
  })

  it('shortens the home directory to ~', () => {
    expect(displayPath('/Users/kev/Robots/servo-arm')).toBe('~/Robots/servo-arm')
    expect(displayPath('/home/pi/robots')).toBe('~/robots')
    expect(displayPath('C:\\Users\\kev\\Robots')).toBe('~\\Robots')
    expect(displayPath('Robots/robot-dog')).toBe('Robots/robot-dog')
  })

  it('turns a project name into a safe folder name', () => {
    expect(projectSlug('Robot Dog')).toBe('robot-dog')
    expect(projectSlug("  Kev's  Buggy v2! ")).toBe('kevs-buggy-v2')
    expect(projectSlug('///')).toBe('')
  })

  it('summarises what a project holds', () => {
    const s = summariseProject({
      folder: '/r/servo-arm',
      robot: {
        name: 'Servo arm',
        board: 'pico2w',
        parts: [
          { id: 'a', lib: 'std', part: 'sg90' },
          { id: 'b', lib: 'std', part: 'sg90' }
        ],
        connections: [{ id: 'w', from: 'a.sig', to: 'board.GP0' }],
        robot: { version: 1, urdf: 'urdf/arm.urdf' }
      } as never,
      root: [
        { name: 'robot.yml', isDir: false },
        { name: 'sweep.py', isDir: false },
        { name: 'code', isDir: true },
        { name: 'base.STL', isDir: false }
      ],
      code: [{ name: 'main.py', isDir: false }, { name: 'notes.txt', isDir: false }],
      stl: [{ name: 'arm.stl', isDir: false }, { name: 'README.txt', isDir: false }]
    })
    expect(s.name).toBe('Servo arm')
    expect(s.code).toEqual(['code/main.py', 'sweep.py'])
    expect(s.print).toEqual(['stl/arm.stl', 'base.STL'])
    expect(s.model).toBe('urdf/arm.urdf')
    expect(electronicsLine(s)).toBe('2 parts, 1 wire')
  })

  it('falls back to the folder name and says when nothing is wired', () => {
    const s = summariseProject({ folder: '/r/lamp', robot: null, root: [] })
    expect(s.name).toBe('lamp')
    expect(electronicsLine(s)).toBe('Nothing wired yet')
    expect(electronicsLine({ parts: 0, wires: 0, board: 'pico' })).toBe('Board chosen, nothing wired yet')
  })

  it('lists file names briefly', () => {
    expect(filesLine(['code/main.py'])).toBe('main.py')
    expect(filesLine(['a.py', 'b.py', 'c.py', 'd.py'])).toBe('a.py, b.py +2 more')
  })

  it('only calls scratch work "not saved" when there is something in it', () => {
    expect(scratchHasWork(null)).toBe(false)
    expect(scratchHasWork({ parts: [], connections: [] })).toBe(false)
    expect(scratchHasWork({ parts: [{ id: 'a', lib: 'l', part: 'p' }], connections: [] })).toBe(true)
    expect(scratchHasWork({ parts: [], connections: [], board: 'pico' })).toBe(true)
  })

  it('plans a code project: main.py and a named robot.yml', () => {
    const p = planProject('Desk lamp', 'code')
    expect(p.entry).toBe('main.py')
    expect(p.files.map((f) => f.path)).toEqual(['main.py'])
    expect(p.robot.name).toBe('Desk lamp')
    expect(p.robot.robot).toBeUndefined()
  })

  it('plans a robot project in the KRF layout, with the model linked', () => {
    const p = planProject('Robot dog', 'robot')
    expect(p.entry).toBe('code/main.py')
    expect(p.files.map((f) => f.path)).toEqual(['code/main.py', 'urdf/robot.urdf', 'stl/README.txt'])
    expect(p.robot.robot?.urdf).toBe('urdf/robot.urdf')
    expect(p.files[1].content).toContain('<robot name="robot_dog">')
    // The manifest survives a round trip through robot.yml.
    const back = robotFromYaml(robotToYaml(p.robot))
    expect(back.name).toBe('Robot dog')
    expect(back.robot?.urdf).toBe('urdf/robot.urdf')
  })

  it('keeps unsaved wiring when saving the scratch work as a project', () => {
    const scratch = {
      name: 'old',
      board: 'pico2w',
      parts: [{ id: 'a', lib: 'std', part: 'led' }],
      connections: []
    }
    const p = planProject('Night light', 'code', scratch)
    expect(p.robot.name).toBe('Night light')
    expect(p.robot.board).toBe('pico2w')
    expect(p.robot.parts).toHaveLength(1)
  })

  it('previews the files a template writes', () => {
    expect(previewTree('robot-dog', 'robot')).toContain('urdf/robot.urdf')
    expect(previewTree('lamp', 'code', ['untitled-1.py'])).toContain('└── untitled-1.py')
    expect(previewTree('arm', 'demo')).toContain('sweep.py')
  })
})
