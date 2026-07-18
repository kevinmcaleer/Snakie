import { describe, it, expect } from 'vitest'
import { SERIAL_USB_FILTERS, describeUsb, USB_VENDORS } from '../src/shared/serial-filters'

/** The Web Serial picker's VID/PID filters + labels (#465). */
describe('serial-filters', () => {
  it('filters are numeric usbVendorId entries for requestPort', () => {
    expect(SERIAL_USB_FILTERS.length).toBe(USB_VENDORS.length)
    for (const f of SERIAL_USB_FILTERS) expect(typeof f.usbVendorId).toBe('number')
    // Raspberry Pi Pico must be offered.
    expect(SERIAL_USB_FILTERS.some((f) => f.usbVendorId === 0x2e8a)).toBe(true)
  })

  it('describeUsb names a known vendor + shows the VID:PID', () => {
    expect(describeUsb(0x2e8a, 0x0005)).toContain('Raspberry Pi')
    expect(describeUsb(0x2e8a, 0x0005)).toContain('2e8a:0005')
  })

  it('describeUsb falls back gracefully for an unknown device', () => {
    const d = describeUsb(0x1234, 0x5678)
    expect(d).toContain('USB serial device')
    expect(d).toContain('1234:5678')
  })
})
