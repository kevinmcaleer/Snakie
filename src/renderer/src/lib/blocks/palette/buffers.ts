import { Order } from '../generator'
import { registerCallRules } from '../python-to-blocks'
import type { BlockDefinition, BlockGroup } from '../registry'

/**
 * `bytes` AND `bytearray` (#1135, epic #1119).
 * =============================================================================
 *
 * The one item in #1119's audit that is a **MicroPython** gap rather than a
 * Python one. On a desktop you can go a long way without ever typing
 * `bytearray`; on a microcontroller you cannot talk to a device without it:
 *
 * ```python
 * buf = bytearray(2)
 * i2c.readfrom_into(addr, buf)
 * i2c.writeto(addr, bytes([0xF4, 0x2E]))
 * uart.write('AT\r\n'.encode())
 * ```
 *
 * Every one of those was `snakie_python_value` text — including in the hardware
 * lessons, where the palette is otherwise strongest.
 *
 * THEY LIVE IN HARDWARE, in a drawer of their own. Not Lists: that drawer's
 * blocks are 1-based and `Array`-checked, and a buffer is neither a list nor a
 * beginner's first data structure. Hardware is where the learner is standing
 * when the need appears, next to the I²C and SPI blocks that ask for one.
 *
 * `bytes` vs `bytearray` IS A REAL DISTINCTION and worth teaching honestly
 * rather than hiding: one you can change, one you cannot. Two blocks with
 * different words — "buffer" for the mutable one — does that without a lecture.
 *
 * THEY CARRY NO SCOPE AT ALL, which is the one place they part company with the
 * drawer around them. Everything else in Hardware reaches `machine` through a
 * template, so "can it speak CircuitPython?" really is a question about the
 * emitter and `scopedByEmitters` answers it. These four are plain Python — core
 * in both runtimes, identical in both — so the honest answer is the same one
 * the rest of the plain-Python palette gives: absent, which `inScope` reads as
 * BOTH. Deriving it would have meant writing a second emitter byte for byte the
 * same as the first purely to make a boolean come out right.
 *
 * TWO BLOCKS THIS DRAWER DELIBERATELY DOES NOT HAVE, for the reason the
 * Dictionaries drawer gives at length: `how many bytes in` is `len(buf)`, which
 * the Lists drawer's **length of** already writes and reads, and byte-by-byte
 * get and set are `buf[n - 1]` and `buf[n - 1] = v`, which **item `n` of** and
 * **set item `n` of** already write exactly. Slicing a buffer — `buf[1:]` — is
 * #1123's, whose sockets check nothing for precisely this reason.
 */

/** The sub-drawer inside Hardware that the buffer blocks live in. */
const BUFFERS: BlockGroup = { id: 'buffers', name: 'Buffers' }

export const BUFFER_BLOCKS: BlockDefinition[] = [
  {
    type: 'snakie_buffer_new',
    category: 'hardware',
    group: BUFFERS,
    help: 'ref-i2c',
    read: { fn: 'bytearray', args: ['SIZE'], shape: 'value', checks: { SIZE: 'Number' } },
    json: {
      message0: 'buffer of %1 bytes',
      args0: [{ type: 'input_value', name: 'SIZE', check: 'Number' }],
      inputsInline: true,
      output: null,
      tooltip:
        'Space for a sensor to write its answer into, all zeroes to start with. A buffer CAN be changed — which is why a sensor can fill it in.'
    },
    toolbox: { inputs: { SIZE: { shadow: { type: 'math_number', fields: { NUM: 2 } } } } },
    code: (block, gen) => [
      `bytearray(${gen.valueToCode(block, 'SIZE', Order.NONE) || '0'})`,
      Order.FUNCTION_CALL
    ]
  },
  {
    // THE LIST GOES IN A SOCKET rather than this block growing its own row of
    // them. `create list with` already grows, with Blockly's own mutator and
    // its own rename behaviour, and a second growable block writing the same
    // brackets would be the same line said twice. It also composes: the hex
    // block from #1127 drops straight into the list, which is how a command
    // byte is actually written.
    type: 'snakie_bytes_of',
    category: 'hardware',
    group: BUFFERS,
    help: 'ref-i2c',
    read: { fn: 'bytes', args: ['LIST'], shape: 'value', checks: { LIST: 'Array' } },
    json: {
      message0: 'bytes from %1',
      args0: [{ type: 'input_value', name: 'LIST', check: 'Array' }],
      inputsInline: true,
      output: null,
      tooltip:
        'A fixed run of bytes, built from a list of numbers — the command you send a chip. Unlike a buffer it cannot be changed afterwards.'
    },
    toolbox: {
      inputs: {
        LIST: {
          shadow: {
            type: 'lists_create_with',
            extraState: { itemCount: 2 },
            inputs: {
              ADD0: { shadow: { type: 'snakie_hex_number', fields: { HEX: 'F4' } } },
              ADD1: { shadow: { type: 'snakie_hex_number', fields: { HEX: '2E' } } }
            }
          }
        }
      }
    },
    code: (block, gen) => [
      `bytes(${gen.valueToCode(block, 'LIST', Order.NONE) || '[]'})`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_bytes_encode',
    category: 'hardware',
    group: BUFFERS,
    help: 'ref-uart',
    read: { fn: 'encode', on: 'TEXT', args: [], shape: 'value' },
    json: {
      message0: 'bytes of text %1',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      inputsInline: true,
      output: null,
      tooltip:
        'Turn a piece of text into the bytes that stand for it, ready to send down a serial line. Python writes it text.encode().'
    },
    toolbox: { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'AT' } } } } },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'TEXT', Order.MEMBER) || "''"}.encode()`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_bytes_decode',
    category: 'hardware',
    group: BUFFERS,
    help: 'ref-uart',
    read: { fn: 'decode', on: 'BUF', args: [], shape: 'value' },
    json: {
      message0: 'text of bytes %1',
      args0: [{ type: 'input_value', name: 'BUF' }],
      inputsInline: true,
      output: 'String',
      tooltip:
        'Read bytes back as text — what a sensor or a radio just said. Python writes it buf.decode().'
    },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'BUF', Order.MEMBER) || "b''"}.decode()`,
      Order.FUNCTION_CALL
    ]
  }
]

/**
 * How the buffer blocks read back (#1135).
 *
 * All four are plain rules. `bytes([…])` needs the list in its socket to be a
 * real block, which is what taught the reader list displays — see
 * `python-to-blocks.ts`.
 */
registerCallRules(
  BUFFER_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : []))
)
