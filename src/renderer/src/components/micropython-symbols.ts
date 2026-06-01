/**
 * Curated, static MicroPython symbol dataset that powers the editor's
 * autocomplete (see `micropython-completions.ts`).
 *
 * This is intentionally hand-maintained rather than introspected from a live
 * device: it gives fast, offline, deterministic suggestions for the modules and
 * members MicroPython developers reach for most often. It is NOT exhaustive —
 * it favours the common surface area (machine, time, network, …) over full
 * coverage, and Monaco's built-in word-based completions still fill the gaps.
 */

/** A member exposed by a module (a class, function, constant, …). */
export interface SymbolMember {
  /** Bare member name, e.g. `Pin` (no module prefix). */
  name: string
  /** Semantic kind, used to pick a Monaco completion icon. */
  kind: 'class' | 'function' | 'constant' | 'variable'
  /** Short one-line `detail` shown to the right of the suggestion. */
  detail?: string
  /** Optional longer hover documentation. */
  doc?: string
}

/** A MicroPython module suggestable after `import`/`from`. */
export interface ModuleSymbol {
  /** Importable module name, e.g. `machine`. */
  name: string
  /** Short `detail` describing the module. */
  detail: string
  /** Optional longer hover documentation. */
  doc?: string
  /** Common members of this module (for `module.` completions). */
  members?: SymbolMember[]
}

/**
 * Members of selected classes, keyed by the bare class name (e.g. `Pin`).
 * Drives completions like `Pin.OUT`, `Pin.IN`, `Pin.PULL_UP` regardless of
 * which module the class was imported from.
 */
export const CLASS_MEMBERS: Record<string, SymbolMember[]> = {
  Pin: [
    { name: 'IN', kind: 'constant', detail: 'Pin.IN', doc: 'Configure the pin as an input.' },
    { name: 'OUT', kind: 'constant', detail: 'Pin.OUT', doc: 'Configure the pin as an output.' },
    {
      name: 'OPEN_DRAIN',
      kind: 'constant',
      detail: 'Pin.OPEN_DRAIN',
      doc: 'Configure the pin as open-drain output.'
    },
    {
      name: 'PULL_UP',
      kind: 'constant',
      detail: 'Pin.PULL_UP',
      doc: 'Enable the internal pull-up resistor.'
    },
    {
      name: 'PULL_DOWN',
      kind: 'constant',
      detail: 'Pin.PULL_DOWN',
      doc: 'Enable the internal pull-down resistor.'
    },
    {
      name: 'IRQ_RISING',
      kind: 'constant',
      detail: 'Pin.IRQ_RISING',
      doc: 'Interrupt on a rising edge.'
    },
    {
      name: 'IRQ_FALLING',
      kind: 'constant',
      detail: 'Pin.IRQ_FALLING',
      doc: 'Interrupt on a falling edge.'
    },
    { name: 'value', kind: 'function', detail: 'value([x])', doc: 'Get or set the pin value.' },
    { name: 'on', kind: 'function', detail: 'on()', doc: 'Set the pin to high (1).' },
    { name: 'off', kind: 'function', detail: 'off()', doc: 'Set the pin to low (0).' },
    { name: 'toggle', kind: 'function', detail: 'toggle()', doc: 'Toggle the pin value.' },
    { name: 'irq', kind: 'function', detail: 'irq(handler, trigger)', doc: 'Configure an interrupt handler.' }
  ],
  Timer: [
    { name: 'ONE_SHOT', kind: 'constant', detail: 'Timer.ONE_SHOT', doc: 'Fire the timer once.' },
    { name: 'PERIODIC', kind: 'constant', detail: 'Timer.PERIODIC', doc: 'Fire the timer repeatedly.' },
    {
      name: 'init',
      kind: 'function',
      detail: 'init(*, mode, period, callback)',
      doc: 'Initialise and start the timer.'
    },
    { name: 'deinit', kind: 'function', detail: 'deinit()', doc: 'Stop and deinitialise the timer.' }
  ],
  ADC: [
    {
      name: 'read_u16',
      kind: 'function',
      detail: 'read_u16()',
      doc: 'Read the ADC as a 16-bit unsigned value (0-65535).'
    },
    { name: 'read', kind: 'function', detail: 'read()', doc: 'Read the raw ADC value.' }
  ],
  I2C: [
    { name: 'scan', kind: 'function', detail: 'scan()', doc: 'Scan the bus for responding devices.' },
    {
      name: 'readfrom',
      kind: 'function',
      detail: 'readfrom(addr, nbytes)',
      doc: 'Read bytes from a device.'
    },
    {
      name: 'writeto',
      kind: 'function',
      detail: 'writeto(addr, buf)',
      doc: 'Write bytes to a device.'
    }
  ]
}

/** The curated MicroPython module catalogue, suggested after `import`/`from`. */
export const MODULES: ModuleSymbol[] = [
  {
    name: 'machine',
    detail: 'Hardware control (pins, buses, timers)',
    doc: 'Functions related to the hardware: pins, ADC, PWM, I2C, SPI, timers, resets.',
    members: [
      { name: 'Pin', kind: 'class', detail: 'machine.Pin', doc: 'Control an I/O pin.' },
      { name: 'PWM', kind: 'class', detail: 'machine.PWM', doc: 'Pulse-width modulation output.' },
      { name: 'ADC', kind: 'class', detail: 'machine.ADC', doc: 'Analog-to-digital conversion.' },
      { name: 'I2C', kind: 'class', detail: 'machine.I2C', doc: 'Two-wire I2C bus.' },
      { name: 'SoftI2C', kind: 'class', detail: 'machine.SoftI2C', doc: 'Software (bit-banged) I2C bus.' },
      { name: 'SPI', kind: 'class', detail: 'machine.SPI', doc: 'Serial peripheral interface bus.' },
      { name: 'UART', kind: 'class', detail: 'machine.UART', doc: 'Serial (UART) communication.' },
      { name: 'Timer', kind: 'class', detail: 'machine.Timer', doc: 'Hardware timer.' },
      { name: 'RTC', kind: 'class', detail: 'machine.RTC', doc: 'Real-time clock.' },
      { name: 'WDT', kind: 'class', detail: 'machine.WDT', doc: 'Watchdog timer.' },
      { name: 'reset', kind: 'function', detail: 'machine.reset()', doc: 'Hard-reset the device.' },
      {
        name: 'soft_reset',
        kind: 'function',
        detail: 'machine.soft_reset()',
        doc: 'Soft-reset the interpreter.'
      },
      {
        name: 'freq',
        kind: 'function',
        detail: 'machine.freq([hz])',
        doc: 'Get or set the CPU frequency.'
      },
      {
        name: 'lightsleep',
        kind: 'function',
        detail: 'machine.lightsleep([ms])',
        doc: 'Enter light-sleep mode.'
      },
      {
        name: 'deepsleep',
        kind: 'function',
        detail: 'machine.deepsleep([ms])',
        doc: 'Enter deep-sleep mode.'
      },
      {
        name: 'unique_id',
        kind: 'function',
        detail: 'machine.unique_id()',
        doc: 'Return the board unique identifier as bytes.'
      },
      {
        name: 'reset_cause',
        kind: 'function',
        detail: 'machine.reset_cause()',
        doc: 'Return the cause of the last reset.'
      }
    ]
  },
  {
    name: 'time',
    detail: 'Time and delays',
    doc: 'Time-related functions, including millisecond/microsecond delays and tick counters.',
    members: [
      { name: 'sleep', kind: 'function', detail: 'time.sleep(seconds)', doc: 'Sleep for the given number of seconds.' },
      { name: 'sleep_ms', kind: 'function', detail: 'time.sleep_ms(ms)', doc: 'Sleep for the given milliseconds.' },
      { name: 'sleep_us', kind: 'function', detail: 'time.sleep_us(us)', doc: 'Sleep for the given microseconds.' },
      { name: 'ticks_ms', kind: 'function', detail: 'time.ticks_ms()', doc: 'Millisecond tick counter (wraps).' },
      { name: 'ticks_us', kind: 'function', detail: 'time.ticks_us()', doc: 'Microsecond tick counter (wraps).' },
      { name: 'ticks_cpu', kind: 'function', detail: 'time.ticks_cpu()', doc: 'Finest-resolution tick counter.' },
      {
        name: 'ticks_diff',
        kind: 'function',
        detail: 'time.ticks_diff(a, b)',
        doc: 'Signed difference between two tick values.'
      },
      {
        name: 'ticks_add',
        kind: 'function',
        detail: 'time.ticks_add(t, delta)',
        doc: 'Offset a tick value by delta.'
      },
      { name: 'time', kind: 'function', detail: 'time.time()', doc: 'Seconds since the epoch.' },
      { name: 'localtime', kind: 'function', detail: 'time.localtime([secs])', doc: 'Convert seconds to a time tuple.' },
      { name: 'mktime', kind: 'function', detail: 'time.mktime(t)', doc: 'Convert a time tuple to seconds.' }
    ]
  },
  {
    name: 'network',
    detail: 'Networking (Wi-Fi, Ethernet)',
    doc: 'Network configuration: Wi-Fi station/access-point interfaces and connectivity.',
    members: [
      { name: 'WLAN', kind: 'class', detail: 'network.WLAN', doc: 'Wi-Fi network interface.' },
      { name: 'STA_IF', kind: 'constant', detail: 'network.STA_IF', doc: 'Station (client) interface id.' },
      { name: 'AP_IF', kind: 'constant', detail: 'network.AP_IF', doc: 'Access-point interface id.' },
      {
        name: 'hostname',
        kind: 'function',
        detail: 'network.hostname([name])',
        doc: 'Get or set the network hostname.'
      }
    ]
  },
  {
    name: 'os',
    detail: 'Filesystem and OS services',
    doc: 'Basic operating-system services: filesystem access, directory listing, uname.',
    members: [
      { name: 'listdir', kind: 'function', detail: 'os.listdir([dir])', doc: 'List directory contents.' },
      { name: 'mkdir', kind: 'function', detail: 'os.mkdir(path)', doc: 'Create a directory.' },
      { name: 'remove', kind: 'function', detail: 'os.remove(path)', doc: 'Remove a file.' },
      { name: 'rename', kind: 'function', detail: 'os.rename(old, new)', doc: 'Rename a file or directory.' },
      { name: 'stat', kind: 'function', detail: 'os.stat(path)', doc: 'Return status information for a path.' },
      { name: 'getcwd', kind: 'function', detail: 'os.getcwd()', doc: 'Return the current working directory.' },
      { name: 'chdir', kind: 'function', detail: 'os.chdir(path)', doc: 'Change the current directory.' },
      { name: 'uname', kind: 'function', detail: 'os.uname()', doc: 'Return system/version information.' }
    ]
  },
  {
    name: 'sys',
    detail: 'Interpreter and runtime info',
    doc: 'System-specific parameters and functions.',
    members: [
      { name: 'platform', kind: 'variable', detail: 'sys.platform', doc: 'Platform identifier string.' },
      { name: 'version', kind: 'variable', detail: 'sys.version', doc: 'Python version string.' },
      { name: 'implementation', kind: 'variable', detail: 'sys.implementation', doc: 'Interpreter implementation info.' },
      { name: 'path', kind: 'variable', detail: 'sys.path', doc: 'Module search path.' },
      { name: 'modules', kind: 'variable', detail: 'sys.modules', doc: 'Mapping of imported modules.' },
      { name: 'exit', kind: 'function', detail: 'sys.exit([code])', doc: 'Terminate the program.' },
      { name: 'print_exception', kind: 'function', detail: 'sys.print_exception(exc)', doc: 'Print an exception traceback.' }
    ]
  },
  {
    name: 'gc',
    detail: 'Garbage collection control',
    doc: 'Control the garbage collector and inspect memory usage.',
    members: [
      { name: 'collect', kind: 'function', detail: 'gc.collect()', doc: 'Run a garbage collection.' },
      { name: 'mem_alloc', kind: 'function', detail: 'gc.mem_alloc()', doc: 'Bytes of allocated heap.' },
      { name: 'mem_free', kind: 'function', detail: 'gc.mem_free()', doc: 'Bytes of free heap.' },
      { name: 'enable', kind: 'function', detail: 'gc.enable()', doc: 'Enable automatic collection.' },
      { name: 'disable', kind: 'function', detail: 'gc.disable()', doc: 'Disable automatic collection.' }
    ]
  },
  {
    name: 'math',
    detail: 'Mathematical functions',
    doc: 'Floating-point mathematics: trigonometry, logarithms, constants.',
    members: [
      { name: 'pi', kind: 'constant', detail: 'math.pi', doc: 'The constant pi.' },
      { name: 'e', kind: 'constant', detail: 'math.e', doc: 'The constant e.' },
      { name: 'sqrt', kind: 'function', detail: 'math.sqrt(x)', doc: 'Square root of x.' },
      { name: 'sin', kind: 'function', detail: 'math.sin(x)', doc: 'Sine of x (radians).' },
      { name: 'cos', kind: 'function', detail: 'math.cos(x)', doc: 'Cosine of x (radians).' },
      { name: 'tan', kind: 'function', detail: 'math.tan(x)', doc: 'Tangent of x (radians).' },
      { name: 'pow', kind: 'function', detail: 'math.pow(x, y)', doc: 'x raised to the power y.' },
      { name: 'log', kind: 'function', detail: 'math.log(x)', doc: 'Natural logarithm of x.' },
      { name: 'floor', kind: 'function', detail: 'math.floor(x)', doc: 'Largest integer <= x.' },
      { name: 'ceil', kind: 'function', detail: 'math.ceil(x)', doc: 'Smallest integer >= x.' },
      { name: 'fabs', kind: 'function', detail: 'math.fabs(x)', doc: 'Absolute value of x as a float.' }
    ]
  },
  {
    name: 'neopixel',
    detail: 'Addressable RGB LEDs (WS2812)',
    doc: 'Driver for NeoPixel (WS2812 / SK6812) addressable LED strips.',
    members: [
      { name: 'NeoPixel', kind: 'class', detail: 'neopixel.NeoPixel(pin, n)', doc: 'A strip of n NeoPixels on a pin.' }
    ]
  },
  {
    name: 'micropython',
    detail: 'MicroPython internals',
    doc: 'Access and control MicroPython internals (emit modes, scheduling, memory info).',
    members: [
      { name: 'const', kind: 'function', detail: 'micropython.const(expr)', doc: 'Declare a compile-time constant.' },
      { name: 'schedule', kind: 'function', detail: 'micropython.schedule(func, arg)', doc: 'Schedule a function to run soon.' },
      { name: 'mem_info', kind: 'function', detail: 'micropython.mem_info()', doc: 'Print memory usage information.' },
      { name: 'opt_level', kind: 'function', detail: 'micropython.opt_level([level])', doc: 'Get or set the optimisation level.' }
    ]
  },
  {
    name: 'bluetooth',
    detail: 'Bluetooth Low Energy',
    doc: 'Low-level Bluetooth Low Energy (BLE) radio access.',
    members: [{ name: 'BLE', kind: 'class', detail: 'bluetooth.BLE', doc: 'The BLE radio interface.' }]
  },
  {
    name: 'framebuf',
    detail: 'Frame buffer for displays',
    doc: 'Manipulate a frame buffer for monochrome or colour pixel displays.',
    members: [
      { name: 'FrameBuffer', kind: 'class', detail: 'framebuf.FrameBuffer', doc: 'A drawable pixel buffer.' },
      { name: 'MONO_VLSB', kind: 'constant', detail: 'framebuf.MONO_VLSB', doc: 'Monochrome, vertical LSB format.' },
      { name: 'RGB565', kind: 'constant', detail: 'framebuf.RGB565', doc: '16-bit RGB565 colour format.' }
    ]
  },
  {
    name: 'uasyncio',
    detail: 'Asynchronous I/O (asyncio)',
    doc: 'MicroPython asyncio scheduler for cooperative multitasking.',
    members: [
      { name: 'run', kind: 'function', detail: 'uasyncio.run(coro)', doc: 'Run a coroutine as the main task.' },
      { name: 'sleep', kind: 'function', detail: 'uasyncio.sleep(s)', doc: 'Sleep for s seconds (async).' },
      { name: 'sleep_ms', kind: 'function', detail: 'uasyncio.sleep_ms(ms)', doc: 'Sleep for ms milliseconds (async).' },
      { name: 'create_task', kind: 'function', detail: 'uasyncio.create_task(coro)', doc: 'Schedule a coroutine as a task.' },
      { name: 'gather', kind: 'function', detail: 'uasyncio.gather(*tasks)', doc: 'Run awaitables concurrently.' }
    ]
  },
  {
    name: 'json',
    detail: 'JSON encoding/decoding',
    doc: 'Serialise and deserialise objects to and from JSON.',
    members: [
      { name: 'dumps', kind: 'function', detail: 'json.dumps(obj)', doc: 'Serialise an object to a JSON string.' },
      { name: 'loads', kind: 'function', detail: 'json.loads(s)', doc: 'Parse a JSON string into an object.' },
      { name: 'dump', kind: 'function', detail: 'json.dump(obj, stream)', doc: 'Serialise an object to a stream.' },
      { name: 'load', kind: 'function', detail: 'json.load(stream)', doc: 'Parse JSON from a stream.' }
    ]
  },
  {
    name: 'random',
    detail: 'Pseudo-random numbers',
    doc: 'Generate pseudo-random numbers.',
    members: [
      { name: 'random', kind: 'function', detail: 'random.random()', doc: 'Random float in [0.0, 1.0).' },
      { name: 'randint', kind: 'function', detail: 'random.randint(a, b)', doc: 'Random integer in [a, b].' },
      { name: 'randrange', kind: 'function', detail: 'random.randrange(stop)', doc: 'Random integer from a range.' },
      { name: 'uniform', kind: 'function', detail: 'random.uniform(a, b)', doc: 'Random float in [a, b].' },
      { name: 'choice', kind: 'function', detail: 'random.choice(seq)', doc: 'Random element from a sequence.' },
      { name: 'seed', kind: 'function', detail: 'random.seed([n])', doc: 'Seed the random number generator.' },
      { name: 'getrandbits', kind: 'function', detail: 'random.getrandbits(n)', doc: 'Integer with n random bits.' }
    ]
  },
  {
    name: 'struct',
    detail: 'Pack/unpack binary data',
    doc: 'Convert between Python values and C structs represented as bytes.',
    members: [
      { name: 'pack', kind: 'function', detail: 'struct.pack(fmt, ...)', doc: 'Pack values into bytes.' },
      { name: 'unpack', kind: 'function', detail: 'struct.unpack(fmt, data)', doc: 'Unpack bytes into a tuple.' },
      { name: 'calcsize', kind: 'function', detail: 'struct.calcsize(fmt)', doc: 'Size in bytes of a format.' }
    ]
  },
  {
    name: 'socket',
    detail: 'TCP/UDP sockets',
    doc: 'Low-level network socket access.',
    members: [
      { name: 'socket', kind: 'class', detail: 'socket.socket()', doc: 'Create a new socket.' },
      { name: 'getaddrinfo', kind: 'function', detail: 'socket.getaddrinfo(host, port)', doc: 'Resolve a host/port.' },
      { name: 'AF_INET', kind: 'constant', detail: 'socket.AF_INET', doc: 'IPv4 address family.' },
      { name: 'SOCK_STREAM', kind: 'constant', detail: 'socket.SOCK_STREAM', doc: 'TCP stream socket type.' },
      { name: 'SOCK_DGRAM', kind: 'constant', detail: 'socket.SOCK_DGRAM', doc: 'UDP datagram socket type.' }
    ]
  },
  {
    name: 'esp',
    detail: 'ESP8266/ESP32 low-level',
    doc: 'Functions related to the ESP8266 and ESP32 (flash access, sleep type).',
    members: [
      { name: 'osdebug', kind: 'function', detail: 'esp.osdebug(level)', doc: 'Set the OS debug log level.' },
      { name: 'flash_size', kind: 'function', detail: 'esp.flash_size()', doc: 'Total flash size in bytes.' }
    ]
  },
  {
    name: 'esp32',
    detail: 'ESP32-specific features',
    doc: 'ESP32-specific functionality: partitions, hall sensor, NVS, raw temperature.',
    members: [
      { name: 'Partition', kind: 'class', detail: 'esp32.Partition', doc: 'Access an ESP32 flash partition.' },
      { name: 'NVS', kind: 'class', detail: 'esp32.NVS', doc: 'Non-volatile storage namespace.' },
      { name: 'raw_temperature', kind: 'function', detail: 'esp32.raw_temperature()', doc: 'Read the internal temperature sensor.' }
    ]
  },
  {
    name: 'rp2',
    detail: 'Raspberry Pi RP2040 (PIO)',
    doc: 'Functionality specific to the RP2040, notably programmable I/O (PIO).',
    members: [
      { name: 'PIO', kind: 'class', detail: 'rp2.PIO', doc: 'A programmable I/O block.' },
      { name: 'StateMachine', kind: 'class', detail: 'rp2.StateMachine', doc: 'A PIO state machine.' },
      { name: 'asm_pio', kind: 'function', detail: '@rp2.asm_pio(...)', doc: 'Decorator defining a PIO program.' }
    ]
  },
  {
    name: 'board',
    detail: 'Board pin definitions (CircuitPython)',
    doc: 'Board-specific pin name definitions.',
    members: []
  },
  {
    name: 'digitalio',
    detail: 'Digital I/O (CircuitPython)',
    doc: 'Digital input/output pin control (CircuitPython API).',
    members: [
      { name: 'DigitalInOut', kind: 'class', detail: 'digitalio.DigitalInOut(pin)', doc: 'A configurable digital pin.' },
      { name: 'Direction', kind: 'class', detail: 'digitalio.Direction', doc: 'Pin direction enumeration.' },
      { name: 'Pull', kind: 'class', detail: 'digitalio.Pull', doc: 'Pull-resistor configuration.' }
    ]
  }
]

/** Fast lookup of a module by name. */
export const MODULES_BY_NAME: Record<string, ModuleSymbol> = Object.fromEntries(
  MODULES.map((m) => [m.name, m])
)
