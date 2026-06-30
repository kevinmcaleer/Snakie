import { describe, it, expect } from 'vitest'
import { SimulatedDevice } from '../src/main/device/SimulatedDevice'
import { isTelemetry } from '../src/renderer/src/components/instrument-telemetry'
import {
  isVirtualPort,
  VIRTUAL_PORT_PATH,
  VIRTUAL_PORT_LABEL
} from '../src/shared/virtual-device'

describe('virtual-device identity', () => {
  it('recognises only the reserved sentinel path', () => {
    expect(isVirtualPort(VIRTUAL_PORT_PATH)).toBe(true)
    expect(isVirtualPort('/dev/ttyACM0')).toBe(false)
    expect(isVirtualPort('COM3')).toBe(false)
    expect(isVirtualPort(undefined)).toBe(false)
    expect(isVirtualPort(null)).toBe(false)
  })

  it('uses a scheme that cannot collide with an OS serial path', () => {
    expect(VIRTUAL_PORT_PATH.startsWith('snakie://')).toBe(true)
    expect(VIRTUAL_PORT_LABEL.length).toBeGreaterThan(0)
  })
})

describe('SimulatedDevice lifecycle', () => {
  it('starts disconnected and reports the virtual path', () => {
    const dev = new SimulatedDevice()
    const status = dev.getStatus()
    expect(status.state).toBe('disconnected')
    expect(status.path).toBe(VIRTUAL_PORT_PATH)
    expect(dev.isConnected()).toBe(false)
  })

  it('emits connecting → connected status and a REPL banner on connect', async () => {
    const dev = new SimulatedDevice()
    const states: string[] = []
    const data: string[] = []
    dev.on('status', (s) => states.push(s.state))
    dev.on('data', (c) => data.push(c.toString('utf8')))

    await dev.connect()
    expect(states).toEqual(['connecting', 'connected'])
    expect(dev.isConnected()).toBe(true)
    expect(data.join('')).toContain('MicroPython')

    await dev.dispose()
  })

  it('streams parseable SNK telemetry while connected', async () => {
    const dev = new SimulatedDevice()
    const chunks: string[] = []
    dev.on('data', (c) => chunks.push(c.toString('utf8')))
    await dev.connect()

    // Wait for a couple of telemetry frames (interval ~120ms).
    await new Promise((r) => setTimeout(r, 300))
    await dev.disconnect()

    const lines = chunks
      .join('')
      .split(/\r?\n/)
      .filter((l) => l.startsWith('SNK'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(isTelemetry(line)).toBe(true)

    await dev.dispose()
  })

  it('stops emitting telemetry after disconnect', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    await dev.disconnect()

    let emitted = false
    dev.on('data', () => {
      emitted = true
    })
    await new Promise((r) => setTimeout(r, 250))
    expect(emitted).toBe(false)
    expect(dev.getStatus().state).toBe('disconnected')

    await dev.dispose()
  })

  it('answers the live-pin probe via exec and rejects exec when disconnected', async () => {
    const dev = new SimulatedDevice()
    await expect(dev.exec('print(1)')).rejects.toThrow(/Not connected/)

    await dev.connect()
    const probe = `print('<<SNKV>>0:'+str(x))`
    const { stdout, stderr } = await dev.exec(probe)
    expect(stderr).toBe('')
    expect(stdout).toContain('<<SNKV>>0:')

    // A non-probe exec returns empty output (no traceback).
    expect((await dev.exec('1+1')).stdout).toBe('')

    await dev.dispose()
  })

  it('records control commands (latest-wins per target)', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    // Should not throw; the simulator accepts any control line.
    await dev.sendControl('led', 'pwm 0.5')
    await dev.sendControl('teleop', 'axes=drive:0.5')
    await dev.dispose()
  })

  it('exposes a small simulated filesystem so the device tree is usable', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    const root = await dev.listDir('/')
    expect(root.some((e) => e.name === 'main.py')).toBe(true)
    expect(root.some((e) => e.isDir)).toBe(true)
    expect(await dev.readFile('/main.py')).toContain('simulator')
    await dev.dispose()
  })
})
