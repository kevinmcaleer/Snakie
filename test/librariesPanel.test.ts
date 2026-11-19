import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The Packages surface is split by what the user is there to do — get something,
 * or see what is on the board — not by "package" versus "module". Asserted
 * against the source because the regression is a quiet one: a list drifting
 * back into the wrong tab still renders and still works.
 */
const panel = readFileSync('src/renderer/src/components/PackagesPanel.tsx', 'utf8')
const modules = readFileSync('src/renderer/src/components/ModulesPanel.tsx', 'utf8')
const skin = readFileSync('src/renderer/src/index.css', 'utf8')

/** The JSX returned for one view of PackagesTab. */
function view(name: 'board' | 'get'): string {
  const board = panel.indexOf("if (view === 'board') {")
  expect(board).toBeGreaterThan(-1)
  const get = panel.indexOf('return (', panel.indexOf('</div>\n    )\n  }', board))
  return name === 'board' ? panel.slice(board, get) : panel.slice(get)
}

describe('Get libraries / On this board', () => {
  it('names the tabs for the job', () => {
    expect(panel).toContain("{ id: 'get', label: 'Get libraries' }")
    expect(panel).toContain("{ id: 'board', label: 'On this board' }")
  })

  it('keeps both halves mounted across a tab change', () => {
    expect(panel).toContain('<PackagesTab view={tab} />')
    expect(panel).toContain("<ModulesPanel view={tab === 'get' ? 'catalog' : 'detected'} />")
  })

  it('puts everything you can add under Get libraries', () => {
    const get = view('get')
    expect(get).toContain('pkgs__search')
    expect(get).toContain('Scan imports')
    expect(get).toContain('Popular libraries')
    expect(get).not.toContain('pkgs__meter')
    expect(get).not.toContain('boardPkgs.map(renderBoardTag)')
  })

  it('puts everything already there under On this board', () => {
    const board = view('board')
    expect(board).toContain('pkgs__meter')
    expect(board).toContain('boardPkgs.map(renderBoardTag)')
    expect(board).not.toContain('pkgs__search')
    expect(board).not.toContain('registry.map(renderTag)')
  })

  it('splits the modules manager the same way', () => {
    const detected = modules.indexOf("if (view === 'detected') {")
    expect(detected).toBeGreaterThan(-1)
    const rest = modules.slice(modules.indexOf('return (', modules.indexOf('}', detected + 200)))
    expect(modules.slice(detected, detected + 400)).toContain('<DetectedModules />')
    expect(rest).toContain('mods__header')
    expect(rest).not.toContain('<DetectedModules />')
  })

  it('no longer wears the green-felt skin', () => {
    expect(skin).not.toMatch(/\[data-theme=[^\]]+\] \.pkgs/)
  })
})
