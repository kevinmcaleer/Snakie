import { describe, expect, it } from 'vitest'
import { microbitVersionFromDetails, microbitMaintenanceFromDetails } from '../src/main/firmware/detect'

/**
 * `microbitVersionFromDetails` reads the BBC micro:bit generation from the
 * `Board ID` line DAPLink writes into DETAILS.TXT on the MICROBIT drive:
 * 9900/9901 = v1 (nRF51), 9903–9906 = v2 (nRF52833). Used to pre-select the
 * matching firmware family in the flash dialog.
 */
describe('microbitVersionFromDetails', () => {
  const details = (boardId: string): string =>
    ['# DAPLink Firmware - see https://daplink.io', 'Unique ID: 99040000abcd', `Board ID: ${boardId}`, 'Family ID: 0x0000'].join('\n')

  it('maps 9900 / 9901 to v1', () => {
    expect(microbitVersionFromDetails(details('9900'))).toBe('v1')
    expect(microbitVersionFromDetails(details('9901'))).toBe('v1')
  })

  it('maps 9903–9906 to v2', () => {
    for (const id of ['9903', '9904', '9905', '9906']) {
      expect(microbitVersionFromDetails(details(id))).toBe('v2')
    }
  })

  it('is case-insensitive on the field name', () => {
    expect(microbitVersionFromDetails('board id: 9904')).toBe('v2')
  })

  it('returns undefined when there is no Board ID or it is unrecognised', () => {
    expect(microbitVersionFromDetails('no board id here')).toBeUndefined()
    expect(microbitVersionFromDetails(details('1234'))).toBeUndefined()
  })
})

describe('microbitMaintenanceFromDetails', () => {
  it('detects bootloader / maintenance mode', () => {
    expect(microbitMaintenanceFromDetails('DAPLink Mode: Bootloader')).toBe(true)
    expect(microbitMaintenanceFromDetails('daplink mode: maintenance')).toBe(true)
  })

  it('treats interface mode (and a missing line) as NOT maintenance', () => {
    expect(microbitMaintenanceFromDetails('DAPLink Mode: Interface')).toBe(false)
    expect(microbitMaintenanceFromDetails('Board ID: 9904')).toBe(false)
  })
})
