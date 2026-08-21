/**
 * Curated CircuitPython symbol dataset (#763, epic #209) — the other half of the
 * editor's autocomplete.
 *
 * Until now `micropython-symbols.ts` carried two empty stubs labelled
 * "(CircuitPython)": a `board` module with no members and a `digitalio` with
 * three. Everything a CircuitPython user actually types — `analogio`, `pwmio`,
 * `busio`, `try_lock`, `Direction.OUTPUT`, `board.SCL` — was missing, while
 * `machine`, `sleep_ms` and `duty_u16` were all suggested to them.
 *
 * Same shape and same discipline as the MicroPython catalogue: hand-maintained,
 * offline, deliberately partial. It covers the modules a learner meets in the
 * first hour plus the two bundle libraries (`neopixel`, `adafruit_motor`) that
 * every starter project reaches for. Plain-Python modules (`math`, `json`,
 * `os`, `sys`, `struct`, `random`, `gc`, `time`) are NOT repeated here — they
 * live once in the MicroPython catalogue tagged `scope: 'both'`, so there is one
 * entry per module rather than two that can drift.
 *
 * ## Adding to it
 *
 * Add a {@link ModuleSymbol} with `scope: 'circuitpython'`. If the module exists
 * on both runtimes with different members, keep ONE entry in the MicroPython
 * catalogue and scope the members instead (see `time` there).
 */
import type { ModuleSymbol, SymbolMember } from './micropython-symbols'

/**
 * The pin names nearly every board defines. `board`'s real contents are
 * per-board — a Feather has `board.D13`, a QT Py has `board.A0` and neither has
 * the other's — so this is the common floor, and `cp-board` teaches `dir(board)`
 * as the way to see the truth for the board in hand.
 */
const BOARD_PINS: SymbolMember[] = [
  { name: 'LED', kind: 'variable', detail: 'board.LED', doc: 'The onboard LED, on boards that have one.' },
  { name: 'A0', kind: 'variable', detail: 'board.A0', doc: 'Analogue pin 0.' },
  { name: 'A1', kind: 'variable', detail: 'board.A1', doc: 'Analogue pin 1.' },
  { name: 'A2', kind: 'variable', detail: 'board.A2', doc: 'Analogue pin 2.' },
  { name: 'A3', kind: 'variable', detail: 'board.A3', doc: 'Analogue pin 3.' },
  { name: 'D0', kind: 'variable', detail: 'board.D0', doc: 'Digital pin 0.' },
  { name: 'D1', kind: 'variable', detail: 'board.D1', doc: 'Digital pin 1.' },
  { name: 'D2', kind: 'variable', detail: 'board.D2', doc: 'Digital pin 2.' },
  { name: 'D13', kind: 'variable', detail: 'board.D13', doc: 'Digital pin 13 — the LED pin on many boards.' },
  { name: 'SCL', kind: 'variable', detail: 'board.SCL', doc: 'The I²C clock pin.' },
  { name: 'SDA', kind: 'variable', detail: 'board.SDA', doc: 'The I²C data pin.' },
  { name: 'SCK', kind: 'variable', detail: 'board.SCK', doc: 'The SPI clock pin.' },
  { name: 'MOSI', kind: 'variable', detail: 'board.MOSI', doc: 'The SPI data-out pin.' },
  { name: 'MISO', kind: 'variable', detail: 'board.MISO', doc: 'The SPI data-in pin.' },
  { name: 'TX', kind: 'variable', detail: 'board.TX', doc: 'The UART transmit pin.' },
  { name: 'RX', kind: 'variable', detail: 'board.RX', doc: 'The UART receive pin.' },
  {
    name: 'I2C',
    kind: 'function',
    detail: 'board.I2C()',
    doc: 'The board\'s default I²C bus, already built on the right pins — shorter than busio.I2C(board.SCL, board.SDA).'
  },
  { name: 'SPI', kind: 'function', detail: 'board.SPI()', doc: "The board's default SPI bus." },
  { name: 'UART', kind: 'function', detail: 'board.UART()', doc: "The board's default UART." },
  {
    name: 'board_id',
    kind: 'variable',
    detail: 'board.board_id',
    doc: "This build's board id, the same string boot_out.txt names."
  }
]

/** The CircuitPython module catalogue. */
export const CIRCUITPYTHON_MODULES: ModuleSymbol[] = [
  {
    name: 'board',
    scope: 'circuitpython',
    detail: "This board's pin names",
    doc: 'Every pin on the board, by the name printed on the silkscreen. `dir(board)` lists exactly what this board has — CircuitPython takes these objects where MicroPython takes a GPIO number.',
    members: BOARD_PINS
  },
  {
    name: 'digitalio',
    scope: 'circuitpython',
    detail: 'Digital pins (in and out)',
    doc: 'The CircuitPython equivalent of `machine.Pin`. Note `value` is an ATTRIBUTE you assign (`led.value = True`), not a method you call.',
    members: [
      {
        name: 'DigitalInOut',
        kind: 'class',
        detail: 'digitalio.DigitalInOut(board.D13)',
        doc: 'A pin you can read or drive. Set `.direction` before using it.'
      },
      {
        name: 'Direction',
        kind: 'class',
        detail: 'digitalio.Direction.OUTPUT',
        doc: 'INPUT or OUTPUT — assign to a pin\'s `.direction`.'
      },
      {
        name: 'Pull',
        kind: 'class',
        detail: 'digitalio.Pull.UP',
        doc: 'UP or DOWN — the internal pull resistor for an input.'
      },
      {
        name: 'DriveMode',
        kind: 'class',
        detail: 'digitalio.DriveMode.PUSH_PULL',
        doc: 'PUSH_PULL or OPEN_DRAIN for an output.'
      }
    ]
  },
  {
    name: 'analogio',
    scope: 'circuitpython',
    detail: 'Analogue in and out',
    doc: 'Reading a voltage (`AnalogIn`) and, on boards with a DAC, writing one (`AnalogOut`). Readings are 0–65535, the same range as MicroPython\'s `read_u16()`.',
    members: [
      {
        name: 'AnalogIn',
        kind: 'class',
        detail: 'analogio.AnalogIn(board.A0)',
        doc: 'Read a voltage. `.value` is 0–65535; `.reference_voltage` scales it to volts.'
      },
      {
        name: 'AnalogOut',
        kind: 'class',
        detail: 'analogio.AnalogOut(board.A0)',
        doc: 'Write a voltage on a board with a true DAC (not PWM).'
      }
    ]
  },
  {
    name: 'pwmio',
    scope: 'circuitpython',
    detail: 'PWM output (dimming, tones, servos)',
    doc: 'The CircuitPython equivalent of `machine.PWM`. `duty_cycle` is a 16-bit ATTRIBUTE, and a pin whose frequency you will change needs `variable_frequency=True` up front.',
    members: [
      {
        name: 'PWMOut',
        kind: 'class',
        detail: 'pwmio.PWMOut(board.D13, frequency=1000)',
        doc: 'A PWM output. Set `.duty_cycle` (0–65535) to dim; pass `variable_frequency=True` to change `.frequency` later.'
      }
    ]
  },
  {
    name: 'busio',
    scope: 'circuitpython',
    detail: 'I²C, SPI and UART buses',
    doc: 'Hardware buses built from `board` pins. I²C is shared with the display and USB stacks, so you must `try_lock()` before talking to it and `unlock()` after.',
    members: [
      {
        name: 'I2C',
        kind: 'class',
        detail: 'busio.I2C(board.SCL, board.SDA)',
        doc: 'A two-wire bus. Lock it before scanning: `while not i2c.try_lock(): pass`.'
      },
      {
        name: 'SPI',
        kind: 'class',
        detail: 'busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)',
        doc: 'A SPI bus. Set the baud rate with `configure()` while locked.'
      },
      {
        name: 'UART',
        kind: 'class',
        detail: 'busio.UART(board.TX, board.RX, baudrate=9600)',
        doc: 'A serial port on two pins.'
      }
    ]
  },
  {
    name: 'microcontroller',
    scope: 'circuitpython',
    detail: 'The chip itself (reset, temperature, pins)',
    doc: 'Low-level access to the microcontroller: reset it, read its temperature, or reach a pin by chip name rather than board name.',
    members: [
      { name: 'cpu', kind: 'variable', detail: 'microcontroller.cpu', doc: 'The CPU — `.temperature`, `.frequency`, `.uid`.' },
      { name: 'pin', kind: 'variable', detail: 'microcontroller.pin.GPIO15', doc: 'Pins by chip name, for pins `board` does not name.' },
      { name: 'reset', kind: 'function', detail: 'microcontroller.reset()', doc: 'Hard-reset the board.' },
      { name: 'nvm', kind: 'variable', detail: 'microcontroller.nvm', doc: 'Bytes that survive a reset, on boards that have it.' }
    ]
  },
  {
    name: 'supervisor',
    scope: 'circuitpython',
    detail: 'Control the auto-reload and restart code.py',
    doc: 'The runtime that runs `code.py`. `supervisor.reload()` restarts your program; `supervisor.runtime.autoreload = False` stops a save from restarting it mid-experiment.',
    members: [
      { name: 'reload', kind: 'function', detail: 'supervisor.reload()', doc: 'Restart code.py from the top, right now.' },
      {
        name: 'runtime',
        kind: 'variable',
        detail: 'supervisor.runtime',
        doc: 'Live state — `.autoreload`, `.serial_connected`, `.usb_connected`.'
      },
      { name: 'ticks_ms', kind: 'function', detail: 'supervisor.ticks_ms()', doc: 'A wrapping millisecond counter, the closest thing to MicroPython\'s ticks_ms().' }
    ]
  },
  {
    name: 'storage',
    scope: 'circuitpython',
    detail: 'Make the filesystem writable from code',
    doc: 'The board\'s filesystem is read-only TO YOUR CODE while the computer has CIRCUITPY mounted. `storage.remount("/", False)` from `boot.py` flips it, at the cost of the drive going read-only for the computer.',
    members: [
      {
        name: 'remount',
        kind: 'function',
        detail: 'storage.remount("/", readonly=False)',
        doc: 'Make / writable from code. Only takes effect from boot.py.'
      },
      { name: 'getmount', kind: 'function', detail: 'storage.getmount("/")', doc: 'The filesystem object for a path.' },
      {
        name: 'disable_usb_drive',
        kind: 'function',
        detail: 'storage.disable_usb_drive()',
        doc: 'Hide CIRCUITPY from the computer entirely (boot.py only).'
      }
    ]
  },
  {
    name: 'rotaryio',
    scope: 'circuitpython',
    detail: 'Rotary encoders',
    doc: 'Counts encoder steps in hardware, so no interrupts to write.',
    members: [
      {
        name: 'IncrementalEncoder',
        kind: 'class',
        detail: 'rotaryio.IncrementalEncoder(board.D1, board.D2)',
        doc: 'Read `.position` — it counts up and down on its own.'
      }
    ]
  },
  {
    name: 'keypad',
    scope: 'circuitpython',
    detail: 'Buttons and key matrices, debounced',
    doc: 'Debounced button and matrix scanning with an event queue — the CircuitPython answer to writing your own debounce loop.',
    members: [
      { name: 'Keys', kind: 'class', detail: 'keypad.Keys((board.D1,), value_when_pressed=False)', doc: 'A set of individual buttons.' },
      { name: 'KeyMatrix', kind: 'class', detail: 'keypad.KeyMatrix(rows, cols)', doc: 'A scanned row/column matrix.' },
      { name: 'Event', kind: 'class', detail: 'keypad.Event', doc: 'One press or release, from the queue.' }
    ]
  },
  {
    name: 'touchio',
    scope: 'circuitpython',
    detail: 'Capacitive touch pins',
    doc: 'Turn a bare pad or wire into a touch button.',
    members: [
      { name: 'TouchIn', kind: 'class', detail: 'touchio.TouchIn(board.A0)', doc: 'Read `.value` — True while touched.' }
    ]
  },
  {
    name: 'pulseio',
    scope: 'circuitpython',
    detail: 'Pulse input and IR',
    doc: 'Measure incoming pulse trains — ultrasonic echoes, IR remotes.',
    members: [
      { name: 'PulseIn', kind: 'class', detail: 'pulseio.PulseIn(board.D7)', doc: 'A buffer of pulse lengths in microseconds.' },
      { name: 'PulseOut', kind: 'class', detail: 'pulseio.PulseOut(pwm)', doc: 'Send a pulse train, e.g. an IR command.' }
    ]
  },
  {
    name: 'wifi',
    scope: 'circuitpython',
    detail: 'Wi-Fi (ESP32-S2/S3, Pico W)',
    doc: 'Connect to a network. Pair with `socketpool` and `adafruit_requests` to make HTTP calls.',
    members: [
      { name: 'radio', kind: 'variable', detail: 'wifi.radio', doc: 'The radio — `.connect(ssid, password)`, `.ipv4_address`.' }
    ]
  },
  {
    name: 'socketpool',
    scope: 'circuitpython',
    detail: 'Sockets for a connected radio',
    doc: 'Sockets come from a pool bound to the radio, rather than from a global module.',
    members: [
      { name: 'SocketPool', kind: 'class', detail: 'socketpool.SocketPool(wifi.radio)', doc: 'The socket factory for a radio.' }
    ]
  },
  {
    name: 'displayio',
    scope: 'circuitpython',
    detail: 'Displays, groups and sprites',
    doc: 'The built-in display stack: a `Group` of `TileGrid`s shown on a display, refreshed for you.',
    members: [
      { name: 'Group', kind: 'class', detail: 'displayio.Group()', doc: 'A container of things to draw.' },
      { name: 'TileGrid', kind: 'class', detail: 'displayio.TileGrid(bitmap, pixel_shader=palette)', doc: 'A bitmap placed on screen.' },
      { name: 'Bitmap', kind: 'class', detail: 'displayio.Bitmap(w, h, colours)', doc: 'An indexed-colour pixel buffer.' },
      { name: 'Palette', kind: 'class', detail: 'displayio.Palette(n)', doc: 'The colours a bitmap\'s indices mean.' }
    ]
  },
  // NOTE: `neopixel` is deliberately NOT here. It exists on both runtimes with
  // the same shape (a built-in on MicroPython, a bundle library on
  // CircuitPython), so it lives once in the MicroPython catalogue tagged
  // `scope: 'both'` — one entry per module name, or a duplicate would shadow the
  // other in `modulesByNameFor`.
  {
    name: 'adafruit_motor',
    scope: 'circuitpython',
    detail: 'Servos and DC motors (bundle library)',
    doc: 'From the Adafruit bundle. Wraps a `pwmio.PWMOut` rather than driving a pin itself — `servo.Servo(pwmio.PWMOut(board.D5, frequency=50))`.',
    members: [
      { name: 'servo', kind: 'variable', detail: 'from adafruit_motor import servo', doc: 'Servo and ContinuousServo.' },
      { name: 'motor', kind: 'variable', detail: 'from adafruit_motor import motor', doc: 'DCMotor over two PWM pins.' },
      { name: 'stepper', kind: 'variable', detail: 'from adafruit_motor import stepper', doc: 'StepperMotor over four PWM pins.' }
    ]
  },
  {
    name: 'asyncio',
    scope: 'circuitpython',
    detail: 'Cooperative multitasking (bundle library)',
    doc: 'From the Adafruit bundle (`asyncio`), spelled with the standard name rather than MicroPython\'s `uasyncio`.',
    members: [
      { name: 'run', kind: 'function', detail: 'asyncio.run(main())', doc: 'Run a coroutine as the main task.' },
      { name: 'sleep', kind: 'function', detail: 'await asyncio.sleep(0.5)', doc: 'Sleep for seconds without blocking other tasks.' },
      { name: 'gather', kind: 'function', detail: 'asyncio.gather(*tasks)', doc: 'Run awaitables concurrently.' },
      { name: 'create_task', kind: 'function', detail: 'asyncio.create_task(coro)', doc: 'Schedule a coroutine as a task.' }
    ]
  }
]

/**
 * Members of CircuitPython classes, keyed by the bare class name — the mirror of
 * `CLASS_MEMBERS`, so `DigitalInOut.` and `Direction.` complete however they
 * were imported.
 *
 * `I2C` appears in both catalogues under the same name and they are NOT the same
 * class: `busio.I2C` adds the lock, which is the difference that bites.
 */
export const CIRCUITPYTHON_CLASS_MEMBERS: Record<string, SymbolMember[]> = {
  DigitalInOut: [
    { name: 'value', kind: 'variable', detail: 'pin.value = True', doc: 'The pin level — an attribute, not a method.' },
    { name: 'direction', kind: 'variable', detail: 'pin.direction = Direction.OUTPUT', doc: 'INPUT or OUTPUT.' },
    { name: 'pull', kind: 'variable', detail: 'pin.pull = Pull.UP', doc: 'The input pull resistor (UP, DOWN or None).' },
    { name: 'drive_mode', kind: 'variable', detail: 'pin.drive_mode', doc: 'PUSH_PULL or OPEN_DRAIN for an output.' },
    {
      name: 'switch_to_output',
      kind: 'function',
      detail: 'switch_to_output(value=False)',
      doc: 'Make it an output in one call.'
    },
    {
      name: 'switch_to_input',
      kind: 'function',
      detail: 'switch_to_input(pull=Pull.UP)',
      doc: 'Make it an input in one call.'
    },
    { name: 'deinit', kind: 'function', detail: 'deinit()', doc: 'Release the pin so something else can use it.' }
  ],
  Direction: [
    { name: 'INPUT', kind: 'constant', detail: 'Direction.INPUT', doc: 'Read the pin.' },
    { name: 'OUTPUT', kind: 'constant', detail: 'Direction.OUTPUT', doc: 'Drive the pin.' }
  ],
  Pull: [
    { name: 'UP', kind: 'constant', detail: 'Pull.UP', doc: 'Idles high; reads False when tied to GND.' },
    { name: 'DOWN', kind: 'constant', detail: 'Pull.DOWN', doc: 'Idles low.' }
  ],
  AnalogIn: [
    { name: 'value', kind: 'variable', detail: 'pot.value', doc: 'The reading, 0–65535.' },
    {
      name: 'reference_voltage',
      kind: 'variable',
      detail: 'pot.reference_voltage',
      doc: 'The full-scale voltage — multiply by value/65535 for volts.'
    },
    { name: 'deinit', kind: 'function', detail: 'deinit()', doc: 'Release the pin.' }
  ],
  AnalogOut: [
    { name: 'value', kind: 'variable', detail: 'dac.value = 32768', doc: 'The output level, 0–65535.' }
  ],
  PWMOut: [
    { name: 'duty_cycle', kind: 'variable', detail: 'pwm.duty_cycle = 32768', doc: '0–65535 — an attribute, not duty_u16().' },
    {
      name: 'frequency',
      kind: 'variable',
      detail: 'pwm.frequency = 50',
      doc: 'Hz. Only settable if the pin was made with variable_frequency=True.'
    },
    { name: 'deinit', kind: 'function', detail: 'deinit()', doc: 'Release the pin and its timer.' }
  ],
  I2C: [
    {
      name: 'try_lock',
      kind: 'function',
      scope: 'circuitpython',
      detail: 'try_lock()',
      doc: 'Take the bus. Returns False if something else has it — loop until it succeeds.'
    },
    { name: 'unlock', kind: 'function', scope: 'circuitpython', detail: 'unlock()', doc: 'Give the bus back. Use try/finally.' },
    { name: 'scan', kind: 'function', detail: 'scan()', doc: 'Addresses that answered. Requires the lock.' },
    {
      name: 'writeto',
      kind: 'function',
      detail: 'writeto(addr, buffer)',
      doc: 'Write bytes to a device.'
    },
    {
      name: 'readfrom_into',
      kind: 'function',
      scope: 'circuitpython',
      detail: 'readfrom_into(addr, buffer)',
      doc: 'Read into a pre-allocated buffer.'
    },
    {
      name: 'writeto_then_readfrom',
      kind: 'function',
      scope: 'circuitpython',
      detail: 'writeto_then_readfrom(addr, out, in_)',
      doc: 'Write a register address, then read the answer.'
    }
  ],
  SPI: [
    {
      name: 'configure',
      kind: 'function',
      detail: 'configure(baudrate=1000000)',
      doc: 'Set the baud rate, polarity and phase (while locked).'
    },
    { name: 'try_lock', kind: 'function', detail: 'try_lock()', doc: 'Take the bus before configuring or transferring.' },
    { name: 'unlock', kind: 'function', detail: 'unlock()', doc: 'Give the bus back.' },
    { name: 'write', kind: 'function', detail: 'write(buffer)', doc: 'Send bytes.' },
    { name: 'readinto', kind: 'function', detail: 'readinto(buffer)', doc: 'Receive bytes into a buffer.' }
  ]
}
