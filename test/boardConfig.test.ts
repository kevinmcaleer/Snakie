import { describe, expect, it } from 'vitest'
// @ts-ignore — plain .mjs beside the generator that uses it; the readers are the
// thing under test, so they are imported rather than re-typed.
import {
  linkerSize,
  nrfMemoryScriptsFor,
  picoSdkBoardFor,
  readBoardConfig,
  readEsp32,
  readMimxrt,
  readNrf,
  readRp2,
  readStm32,
  sizeExpression
} from '../scripts/board-config.mjs'

/**
 * Reading sizes out of MicroPython's own per-board build configuration (#897).
 *
 * The fixtures below are real fragments of upstream's tree, kept verbatim
 * including the comments, because the comments are where several of these go
 * wrong. Every test here is about the same question: is this number about THIS
 * board, or about a board whose configuration it happens to borrow?
 */

describe('size expressions', () => {
  it('reads the forms upstream actually writes', () => {
    expect(sizeExpression('(8 * 1024 * 1024)')).toBe(8 * 1024 * 1024)
    expect(sizeExpression('0x800000  # 8MB')).toBe(8 * 1024 * 1024)
    expect(sizeExpression('16777216')).toBe(16 * 1024 * 1024)
    expect(sizeExpression('(1 * 1024 * 1024) /* entire flash */')).toBe(1024 * 1024)
  })

  it('refuses anything with a symbol in it', () => {
    // Several boards write their storage size as arithmetic ON the flash size.
    // Resolving that means knowing what the symbol was, and being wrong about it
    // is how a firmware reservation gets published as a flash size.
    expect(sizeExpression('PICO_FLASH_SIZE_BYTES - (1024 * 1024)')).toBeNull()
    expect(sizeExpression('MICROPY_HW_FLASH_SIZE')).toBeNull()
    expect(sizeExpression('')).toBeNull()
    expect(sizeExpression(null)).toBeNull()
  })
})

describe('which chip an stm32 board carries', () => {
  it('reports the board’s name and the build’s, because neither always wins', () => {
    // The Espruino Pico BUILDS as an F401xE and IS an F401CD — 384 KB of flash,
    // not the 512 KB the build's memory map allows for. The board is right.
    const pico = readStm32({
      'mpconfigboard.h': '#define MICROPY_HW_MCU_NAME "STM32F401CD"',
      'mpconfigboard.mk': 'CMSIS_MCU = STM32F401xE\n'
    })
    expect(pico.part).toBe('STM32F401CD')
    expect(pico.partAlso).toBe('STM32F401xE')

    // The HydraBus calls itself "STM32F4", which is not a part. The build is.
    const hydra = readStm32({
      'mpconfigboard.h': '#define MICROPY_HW_MCU_NAME "STM32F4"',
      'mpconfigboard.mk': 'CMSIS_MCU = STM32F405xx\n'
    })
    expect(hydra.part).toBe('STM32F4')
    expect(hydra.partAlso).toBe('STM32F405xx')
  })
})

describe('i.MX RT, the port that states its own sizes', () => {
  // Verbatim from ports/mimxrt/boards/MIMXRT1060_EVK/mpconfigboard.mk.
  const evk = {
    'mpconfigboard.mk': [
      'MCU_SERIES = MIMXRT1062',
      'MCU_VARIANT = MIMXRT1062DVL6A',
      '',
      'MICROPY_HW_FLASH_TYPE = qspi_nor_flash',
      'MICROPY_HW_FLASH_SIZE = 0x800000  # 8MB',
      'MICROPY_HW_FLASH_RESERVED ?= 0x1000  # 4KB',
      '',
      'MICROPY_HW_SDRAM_AVAIL = 1',
      'MICROPY_HW_SDRAM_SIZE  = 0x2000000  # 32MB'
    ].join('\n')
  }

  it('reads the flash chip and the SDRAM, and says where from', () => {
    const got = readMimxrt(evk, { boardId: 'MIMXRT1060_EVK' })
    expect(got.part).toBe('MIMXRT1062')
    expect(got.flash).toBe(8 * 1024 * 1024)
    expect(got.externalRam).toBe(32 * 1024 * 1024)
    expect(got.flashSource).toContain('MIMXRT1060_EVK/mpconfigboard.mk')
    expect(got.flashSource).toContain('MICROPY_HW_FLASH_SIZE')
  })

  it('offers no external RAM for a board that declares none', () => {
    const teensy = readMimxrt(
      { 'mpconfigboard.mk': 'MCU_SERIES = MIMXRT1062\nMICROPY_HW_FLASH_SIZE = 0x200000  # 2MB\n' },
      { boardId: 'TEENSY40' }
    )
    expect(teensy.flash).toBe(2 * 1024 * 1024)
    expect(teensy.externalRam).toBeNull()
    expect(teensy.externalRamSource).toBeNull()
  })
})

describe('esp32, which almost never says', () => {
  it('takes only the size that is selected', () => {
    // SIL_MANT1S lists the sizes it is NOT using with an empty value. Matching
    // the name without the `=y` would read the first one and get 4 MB.
    const sdk = [
      'CONFIG_ESPTOOLPY_FLASHSIZE_4MB=',
      'CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y',
      'CONFIG_ESPTOOLPY_FLASHSIZE_16MB=',
      'CONFIG_ESPTOOLPY_FLASHSIZE="8MB"'
    ].join('\n')
    expect(readEsp32({ 'sdkconfig.board': sdk }, { boardId: 'SIL_MANT1S' }).flash).toBe(
      8 * 1024 * 1024
    )
  })

  it('says nothing for the 42 boards that set no size at all', () => {
    expect(readEsp32({ 'sdkconfig.board': 'CONFIG_SPIRAM_MEMTEST=\n' }, {}).flash).toBeNull()
    expect(readEsp32({}, {}).flash).toBeNull()
  })
})

describe('nrf, where the sub-variant is not a part', () => {
  // Verbatim from ports/nrf/boards/nrf52832_512k_64k.ld and its siblings.
  const map = (flash: string, ram: string) =>
    `/*\n    GNU linker script\n*/\n\n_flash_size = ${flash};\n_ram_size   = ${ram};\n` +
    `_micropy_hw_romfs_part0_size = 128K;\n_stack_size = 8K;\n`

  it('reads the memory map the board is actually linked against', () => {
    // `nrf52832` alone spans the 512 KB/64 KB QFAA and the 256 KB/32 KB QFAB.
    // The makefile picks one, and a 512 KB image will not fit a QFAB.
    const got = readNrf(
      {
        'mpconfigboard.mk':
          'MCU_VARIANT = nrf52\nMCU_SUB_VARIANT = nrf52832\nSOFTDEV_VERSION = 6.1.1\n' +
          'LD_FILES += boards/nrf52832_512k_64k.ld\n'
      },
      { boardId: 'PCA10040', nrfScripts: { 'nrf52832_512k_64k.ld': map('512K', '64K') } }
    )
    expect(got.part).toBe('nrf52832')
    expect(got.chipMemory).toEqual({
      flash: 512 * 1024,
      sram: 64 * 1024,
      source: 'MicroPython ports/nrf/boards/nrf52832_512k_64k.ld'
    })
  })

  it('ignores the bootloader and softdevice scripts listed beside it', () => {
    // The micro:bit v1 and the XIAO nRF52840 both pull in a second script; only
    // the memory map defines both sizes, which is what picks it out.
    const got = readNrf(
      {
        'mpconfigboard.mk':
          'MCU_SUB_VARIANT = nrf51822\n' +
          'LD_FILES += boards/MICROBIT/custom_nrf51822_s110_microbit.ld boards/nrf51x22_256k_16k.ld\n'
      },
      {
        boardId: 'MICROBIT',
        nrfScripts: {
          'nrf51x22_256k_16k.ld': map('256K', '16K'),
          'custom_nrf51822_s110_microbit.ld': '_sd_size = 88K;\n_sd_ram = 8K;\n'
        }
      }
    )
    expect(got.chipMemory?.flash).toBe(256 * 1024)
    expect(got.chipMemory?.sram).toBe(16 * 1024)
  })

  it('says nothing when two scripts would both answer', () => {
    const got = readNrf(
      { 'mpconfigboard.mk': 'MCU_SUB_VARIANT = nrf52832\n' },
      {
        boardId: 'X',
        nrfScripts: { 'a.ld': map('512K', '64K'), 'b.ld': map('256K', '32K') }
      }
    )
    expect(got.chipMemory).toBeUndefined()
  })

  it('says nothing at all when no script was found', () => {
    const got = readNrf({ 'mpconfigboard.mk': 'MCU_SUB_VARIANT = nrf52832\n' }, { boardId: 'X' })
    expect(got.part).toBe('nrf52832')
    expect(got.chipMemory).toBeUndefined()
  })

  it('asks only for the top-level scripts a board names', () => {
    expect(
      nrfMemoryScriptsFor({
        'mpconfigboard.mk':
          'LD_FILES += boards/SEEED_XIAO_NRF52/XIAO_bootloader.ld boards/nrf52840_1M_256k.ld\n'
      })
    ).toEqual(['nrf52840_1M_256k.ld'])
  })

  it('reads the sizes the way a linker script writes them', () => {
    expect(linkerSize('512K')).toBe(512 * 1024)
    expect(linkerSize('1M')).toBe(1024 * 1024)
    expect(linkerSize('0x40000')).toBe(0x40000)
    expect(linkerSize('_flash_size')).toBeNull()
  })
})

describe('rp2, where the header may be another board’s', () => {
  const header = (mb: number) =>
    `// pico_cmake_set_default PICO_FLASH_SIZE_BYTES = (${mb} * 1024 * 1024)\n` +
    `#ifndef PICO_FLASH_SIZE_BYTES\n#define PICO_FLASH_SIZE_BYTES (${mb} * 1024 * 1024)\n#endif\n`

  it('takes a pico-sdk header whose name IS this board', () => {
    const got = readRp2(
      { 'mpconfigboard.cmake': 'set(PICO_BOARD "seeed_xiao_rp2040")\n' },
      { boardId: 'SEEED_XIAO_RP2040', picoSdkHeaders: { seeed_xiao_rp2040: header(2) } }
    )
    expect(got.flash).toBe(2 * 1024 * 1024)
    expect(got.flashSource).toContain('pico-sdk')
  })

  it('matches across naming styles, so punctuation does not lose a board', () => {
    const got = readRp2(
      { 'mpconfigboard.cmake': 'set(PICO_BOARD "weact_studio_rp2350b_core")\n' },
      {
        boardId: 'WEACTSTUDIO_RP2350B_CORE',
        picoSdkHeaders: { weact_studio_rp2350b_core: header(16) }
      }
    )
    expect(got.flash).toBe(16 * 1024 * 1024)
  })

  it('REFUSES a header belonging to a different board', () => {
    // The heart of it. `W5500_EVB_PICO` points at the W5100S board's header, and
    // `CYTRON_MOTION_2350_PRO` at a Raspberry Pi Pico 2's. Reading the flash out
    // of those gives a correct figure about the wrong board.
    expect(
      readRp2(
        { 'mpconfigboard.cmake': 'set(PICO_BOARD "wiznet_w5100s_evb_pico")\n' },
        { boardId: 'W5500_EVB_PICO', picoSdkHeaders: { wiznet_w5100s_evb_pico: header(2) } }
      ).flash
    ).toBeNull()
    expect(
      readRp2(
        { 'mpconfigboard.cmake': 'set(PICO_BOARD "pico2")\n' },
        { boardId: 'CYTRON_MOTION_2350_PRO', picoSdkHeaders: { pico2: header(4) } }
      ).flash
    ).toBeNull()
  })

  it('takes a header the board ships in its own directory', () => {
    const got = readRp2(
      { 'mpconfigboard.cmake': 'set(PICO_BOARD "sparkfun_xrp_controller")\n' },
      { boardId: 'SPARKFUN_XRP_CONTROLLER', ownHeaders: { 'sparkfun_xrp_controller.h': header(16) } }
    )
    expect(got.flash).toBe(16 * 1024 * 1024)
    expect(got.flashSource).toContain('ports/rp2/boards/SPARKFUN_XRP_CONTROLLER')
  })

  it('takes a size the board sets outright', () => {
    const got = readRp2(
      {
        'mpconfigboard.cmake':
          'set(PICO_BOARD none)\nset(PICO_FLASH_SIZE_BYTES 4194304)\n' +
          'set(MICROPY_HW_FLASH_STORAGE_BYTES 3145728)\n'
      },
      { boardId: 'SIL_RP2040_SHIM' }
    )
    expect(got.flash).toBe(4 * 1024 * 1024)
    expect(got.flashSource).toContain('SIL_RP2040_SHIM/mpconfigboard.cmake')
  })

  it('never reads the filesystem partition as the flash size', () => {
    // `MICROPY_HW_FLASH_STORAGE_BYTES` is 1408 KB on a 2 MB Pico. It is the
    // tempting field and it is the wrong one, so nothing may come of it alone.
    const got = readRp2(
      { 'mpconfigboard.cmake': 'set(MICROPY_HW_FLASH_STORAGE_BYTES 1441792)  # 1408 * 1024\n' },
      { boardId: 'SOME_BOARD' }
    )
    expect(got.flash).toBeNull()
  })

  it('throws out a pairing where the filesystem would not fit in the flash', () => {
    const got = readRp2(
      {
        'mpconfigboard.cmake':
          'set(PICO_BOARD "tiny_board")\nset(MICROPY_HW_FLASH_STORAGE_BYTES 15728640)\n'
      },
      { boardId: 'TINY_BOARD', picoSdkHeaders: { tiny_board: header(2) } }
    )
    expect(got.flash).toBeNull()
  })

  it('names only the pico-sdk headers worth fetching', () => {
    expect(
      picoSdkBoardFor({ 'mpconfigboard.cmake': 'set(PICO_BOARD "seeed_xiao_rp2040")' }, 'SEEED_XIAO_RP2040')
    ).toBe('seeed_xiao_rp2040')
    expect(
      picoSdkBoardFor({ 'mpconfigboard.cmake': 'set(PICO_BOARD "pico_w")' }, 'CYTRON_NANOXRP_CONTROLLER')
    ).toBeNull()
  })
})

describe('dispatch', () => {
  it('says nothing for a port with no reader, rather than throwing', () => {
    expect(readBoardConfig('cc3200', {}, { boardId: 'WIPY' })).toEqual({})
    expect(readBoardConfig('esp8266', {}, { boardId: 'ESP8266_GENERIC' })).toEqual({})
  })
})
