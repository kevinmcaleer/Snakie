import { describe, it, expect } from 'vitest'
import { defaultExampleName, parsePartHelp } from '../src/renderer/src/components/part-help-meta'

const withFm = `---
kevsrobots: https://www.kevsrobots.com/learn/parts/sg90/
example: sg90_sweep.py
---
# SG90 Servo

Text here.

\`\`\`python
from servo import Servo
s = Servo(16)
s.angle(90)
\`\`\`
`

describe('parsePartHelp', () => {
  it('extracts the guide URL, example name, strips front matter, pulls the code', () => {
    const m = parsePartHelp(withFm)
    expect(m.guideUrl).toBe('https://www.kevsrobots.com/learn/parts/sg90/')
    expect(m.exampleName).toBe('sg90_sweep.py')
    expect(m.body.startsWith('# SG90 Servo')).toBe(true)
    expect(m.body).not.toContain('kevsrobots:')
    expect(m.exampleCode).toBe('from servo import Servo\ns = Servo(16)\ns.angle(90)\n')
  })

  it('accepts `guide:` as an alias for the URL', () => {
    expect(parsePartHelp('---\nguide: https://x.test/\n---\nbody').guideUrl).toBe('https://x.test/')
  })

  it('handles no front matter (body verbatim; code still extracted)', () => {
    const m = parsePartHelp('# Plain\n\n```py\nx = 1\n```\n')
    expect(m.guideUrl).toBeUndefined()
    expect(m.exampleName).toBeUndefined()
    expect(m.body).toContain('# Plain')
    expect(m.exampleCode).toBe('x = 1\n')
  })

  it('handles no code block + empty/missing input', () => {
    expect(parsePartHelp('# Just prose').exampleCode).toBeUndefined()
    expect(parsePartHelp('').body).toBe('')
    expect(parsePartHelp(null).body).toBe('')
  })
})

describe('defaultExampleName', () => {
  it('derives a safe tab name from the article id', () => {
    expect(defaultExampleName('part-sg90')).toBe('sg90_example.py')
    expect(defaultExampleName('part-hc sr04')).toBe('hc_sr04_example.py')
  })
})
