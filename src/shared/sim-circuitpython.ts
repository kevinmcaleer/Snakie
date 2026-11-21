/**
 * CircuitPython's core modules for the MicroPython WASM sim.
 * =============================================================================
 *
 * The simulator is the MicroPython WebAssembly port; there is no CircuitPython
 * WASM build to run instead. CircuitPython code mostly differs from MicroPython
 * in its hardware modules rather than the language, so this installs Python
 * shims for those modules on top of the simulated `machine` (sim-machine.ts):
 *
 *   board, digitalio, pwmio, analogio, busio, microcontroller, supervisor,
 *   plus `time.monotonic()` / `time.monotonic_ns()`.
 *
 * They drive the SAME simulated `machine.Pin` / `PWM` / `ADC` objects, so the
 * board view's live pin states (#1318) light up for CircuitPython code too. None
 * of these names exist in MicroPython, so installing them unconditionally can't
 * change what a MicroPython program does.
 *
 * Board pins follow the Raspberry Pi Pico's CircuitPython names: `board.GP0` …
 * `board.GP28`, `board.LED`, and `board.A0` … `board.A3` (GP26 … GP29).
 *
 * Must run AFTER SIM_MACHINE_PY. Wrapped in a function so it leaves nothing in
 * the REPL's globals, only entries in `sys.modules`.
 */
export const SIM_CIRCUITPY_PY = `
def __snakie_install_circuitpython():
    import sys, time
    machine = sys.modules.get('machine')
    if machine is None:
        return
    class _ns:
        pass

    # --- microcontroller ---------------------------------------------------
    mc = _ns()
    class Pin:
        def __init__(self, id, name): self.id=id; self._name=name
        def __repr__(self): return 'board.' + self._name
        def __eq__(self, other): return isinstance(other, Pin) and other.id == self.id
        def __hash__(self): return hash(self.id)
    mc.Pin = Pin
    class _Cpu:
        frequency = 125000000
        voltage = 3.3
        uid = b'SNAKIEsim'
        @property
        def temperature(self): return 27.0
    mc.cpu = _Cpu()
    mc.cpus = (mc.cpu,)
    def _noop(*a, **k): return None
    mc.reset = _noop
    mc.on_next_reset = _noop
    mc.delay_us = lambda us: time.sleep_us(int(us))
    mc.nvm = bytearray(256)
    pins = _ns()
    mc.pin = pins

    # --- board ---------------------------------------------------------------
    board = _ns()
    board.board_id = 'raspberry_pi_pico'
    for n in range(30):
        p = Pin(n, 'GP%d' % n)
        setattr(pins, 'GPIO%d' % n, p)
        # GP29 is the VSYS monitor: CircuitPython names it A3, not GP29.
        if n < 29: setattr(board, 'GP%d' % n, p)
    board.LED = Pin('LED', 'LED')
    for i in range(4):
        setattr(board, 'A%d' % i, getattr(pins, 'GPIO%d' % (26 + i)))
    board.VOLTAGE_MONITOR = board.A3

    def _pid(pin):
        return pin.id if isinstance(pin, Pin) else pin

    # --- digitalio -----------------------------------------------------------
    dio = _ns()
    class Direction:
        INPUT = 'INPUT'
        OUTPUT = 'OUTPUT'
    class Pull:
        UP = 'UP'
        DOWN = 'DOWN'
    class DriveMode:
        PUSH_PULL = 'PUSH_PULL'
        OPEN_DRAIN = 'OPEN_DRAIN'
    class DigitalInOut:
        def __init__(self, pin):
            self._pin = machine.Pin(_pid(pin))
            self._dir = Direction.INPUT
            self._pull = None
            self.drive_mode = DriveMode.PUSH_PULL
        @property
        def direction(self): return self._dir
        @direction.setter
        def direction(self, d):
            self._dir = d
            if d == Direction.OUTPUT:
                self._pin.init(machine.Pin.OUT, value=self._pin.value())
        @property
        def value(self):
            v = self._pin.value()
            if self._dir == Direction.INPUT and self._pull == Pull.UP:
                return True   # nothing presses the button on the sim
            return bool(v)
        @value.setter
        def value(self, v): self._pin.value(1 if v else 0)
        @property
        def pull(self): return self._pull
        @pull.setter
        def pull(self, p): self._pull = p
        def switch_to_output(self, value=False, drive_mode=DriveMode.PUSH_PULL):
            self.direction = Direction.OUTPUT
            self.drive_mode = drive_mode
            self.value = value
        def switch_to_input(self, pull=None):
            self._dir = Direction.INPUT
            self._pull = pull
        def deinit(self): pass
        def __enter__(self): return self
        def __exit__(self, *a): self.deinit()
    dio.DigitalInOut = DigitalInOut
    dio.Direction = Direction
    dio.Pull = Pull
    dio.DriveMode = DriveMode

    # --- pwmio ---------------------------------------------------------------
    pwmio = _ns()
    class PWMOut:
        def __init__(self, pin, *, duty_cycle=0, frequency=500, variable_frequency=False):
            self._pwm = machine.PWM(machine.Pin(_pid(pin)), freq=frequency, duty_u16=duty_cycle)
            self._duty = duty_cycle
            self._freq = frequency
        @property
        def duty_cycle(self): return self._duty
        @duty_cycle.setter
        def duty_cycle(self, d):
            d = int(d)
            if d < 0 or d > 65535:
                raise ValueError('duty_cycle must be 0-65535')
            self._duty = d
            self._pwm.duty_u16(d)
        @property
        def frequency(self): return self._freq
        @frequency.setter
        def frequency(self, f):
            self._freq = int(f)
            self._pwm.freq(self._freq)
        def deinit(self): self._pwm.deinit()
        def __enter__(self): return self
        def __exit__(self, *a): self.deinit()
    pwmio.PWMOut = PWMOut

    # --- analogio ------------------------------------------------------------
    aio = _ns()
    class AnalogIn:
        def __init__(self, pin): self._adc = machine.ADC(machine.Pin(_pid(pin)))
        @property
        def value(self): return self._adc.read_u16()
        reference_voltage = 3.3
        def deinit(self): pass
        def __enter__(self): return self
        def __exit__(self, *a): self.deinit()
    class AnalogOut:
        def __init__(self, pin): self._v = 0; self._id = _pid(pin)
        @property
        def value(self): return self._v
        @value.setter
        def value(self, v): self._v = int(v)
        def deinit(self): pass
    aio.AnalogIn = AnalogIn
    aio.AnalogOut = AnalogOut

    # --- busio ---------------------------------------------------------------
    busio = _ns()
    class _Lockable:
        _locked = False
        def try_lock(self):
            if self._locked: return False
            self._locked = True
            return True
        def unlock(self): self._locked = False
        def deinit(self): pass
        def __enter__(self): return self
        def __exit__(self, *a): self.deinit()
    class I2C(_Lockable):
        def __init__(self, scl, sda, *, frequency=100000, timeout=255):
            self._bus = machine.I2C(0)
        def scan(self): return self._bus.scan()
        def writeto(self, address, buffer, *, start=0, end=None): pass
        def readfrom_into(self, address, buffer, *, start=0, end=None):
            for i in range(start, len(buffer) if end is None else end): buffer[i] = 0
        def writeto_then_readfrom(self, address, out_buf, in_buf, **k):
            self.readfrom_into(address, in_buf)
    class SPI(_Lockable):
        def __init__(self, clock, MOSI=None, MISO=None, **k): pass
        def configure(self, **k): pass
        def write(self, buf, **k): pass
        def readinto(self, buf, **k):
            for i in range(len(buf)): buf[i] = 0
        def write_readinto(self, out_buf, in_buf, **k): self.readinto(in_buf)
    class UART:
        def __init__(self, tx=None, rx=None, *, baudrate=9600, **k): self.baudrate = baudrate
        in_waiting = 0
        def read(self, nbytes=None): return None
        def readline(self): return None
        def write(self, buf): return len(buf)
        def reset_input_buffer(self): pass
        def deinit(self): pass
    busio.I2C = I2C
    busio.SPI = SPI
    busio.UART = UART

    # --- supervisor ----------------------------------------------------------
    sup = _ns()
    class _Runtime:
        serial_connected = True
        serial_bytes_available = False
        usb_connected = True
    sup.runtime = _Runtime()
    sup.ticks_ms = lambda: time.ticks_ms() & 0x3FFFFFFF
    sup.reload = _noop
    sup.set_next_code_file = _noop
    sup.disable_autoreload = _noop

    # --- time additions --------------------------------------------------------
    _t0 = time.ticks_ms()
    try:
        if not hasattr(time, 'monotonic'):
            time.monotonic = lambda: time.ticks_diff(time.ticks_ms(), _t0) / 1000
        if not hasattr(time, 'monotonic_ns'):
            time.monotonic_ns = lambda: time.ticks_diff(time.ticks_ms(), _t0) * 1000000
    except Exception:
        pass

    sys.modules['microcontroller'] = mc
    sys.modules['board'] = board
    sys.modules['digitalio'] = dio
    sys.modules['pwmio'] = pwmio
    sys.modules['analogio'] = aio
    sys.modules['busio'] = busio
    sys.modules['supervisor'] = sup
__snakie_install_circuitpython()
del __snakie_install_circuitpython
`
