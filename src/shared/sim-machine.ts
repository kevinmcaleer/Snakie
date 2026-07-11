/**
 * A simulated `machine` module for the MicroPython WASM sim — epic #267.
 * =============================================================================
 *
 * The official `@micropython/micropython-webassembly-pyscript` port has NO
 * `machine` module (no hardware), so `from machine import Pin` — the very first
 * line of almost every MicroPython lesson — raises `ImportError`. That's a broken
 * first experience for a Chromebook classroom (and the desktop sim too).
 *
 * This Python is `runPython`'d once, right after the interpreter boots, to build a
 * fake `machine` module and register it in `sys.modules`. The peripherals are
 * no-ops with plausible behaviour: `Pin` remembers its value + on/off/toggle,
 * `PWM` accepts freq/duty, `ADC.read_u16()` returns a gently varying value (so
 * "plot a sensor" is interesting), `I2C.scan()` is empty, etc. Enough for intro
 * code to RUN. It's wrapped in a function so it doesn't leave names in the REPL
 * globals, only `sys.modules['machine']`.
 */
export const SIM_MACHINE_PY = `
def __snakie_install_machine():
    import sys, math, time
    # MicroPython's minimal types module has no ModuleType, so use a class as the
    # module namespace -- sys.modules can hold any object with the right attrs.
    class _machine_ns:
        pass
    m = _machine_ns

    class Pin:
        IN=0; OUT=1; OPEN_DRAIN=2
        PULL_UP=1; PULL_DOWN=2; PULL_HOLD=4
        IRQ_RISING=1; IRQ_FALLING=2
        def __init__(self, id, mode=-1, pull=-1, value=None):
            self.id=id; self._mode=mode; self._pull=pull
            self._v=1 if value else 0
        def init(self, mode=-1, pull=-1, value=None):
            if value is not None: self._v=1 if value else 0
        def value(self, v=None):
            if v is None: return self._v
            self._v=1 if v else 0
        def on(self): self._v=1
        def off(self): self._v=0
        def high(self): self._v=1
        def low(self): self._v=0
        def toggle(self): self._v^=1
        def irq(self, *a, **k): return None
        def __call__(self, v=None): return self.value(v)
    m.Pin=Pin

    class Signal(Pin):
        def __init__(self, pin, invert=False, **k):
            super().__init__(getattr(pin,'id',pin)); self._inv=invert

    class PWM:
        def __init__(self, dest, freq=None, duty_u16=None, duty_ns=None):
            self._pin=dest; self._freq=freq or 0; self._duty=duty_u16 or 0
        def freq(self, f=None):
            if f is None: return self._freq
            self._freq=f
        def duty_u16(self, d=None):
            if d is None: return self._duty
            self._duty=d
        def duty_ns(self, d=None):
            if d is None: return 0
        def duty(self, d=None):
            if d is None: return self._duty>>10
            self._duty=d<<10
        def init(self, *a, **k): pass
        def deinit(self): pass
    m.PWM=PWM

    class ADC:
        CORE_TEMP=4
        def __init__(self, pin, **k): self._pin=pin
        def read_u16(self):
            # gently varying so a plotted "sensor" moves
            return int(32768 + 24000*math.sin(time.ticks_ms()/700.0)) & 0xFFFF
        def read_uv(self): return self.read_u16()*50
        def read(self): return self.read_u16()>>4
    m.ADC=ADC

    class _Bus:
        def __init__(self, *a, **k): pass
        def scan(self): return []
        def readfrom(self, addr, n, *a): return bytes(n)
        def readfrom_into(self, addr, buf, *a): return None
        def writeto(self, addr, buf, *a): return len(buf) if hasattr(buf,'__len__') else 0
        def readfrom_mem(self, addr, memaddr, n, *a): return bytes(n)
        def writeto_mem(self, addr, memaddr, buf, *a): return None
        def read(self, n=1, *a): return bytes(n)
        def write(self, buf, *a): return None
        def init(self, *a, **k): pass
        def deinit(self): pass
        def any(self): return 0
    m.I2C=_Bus; m.SoftI2C=_Bus; m.SPI=_Bus; m.SoftSPI=_Bus; m.UART=_Bus

    class Timer:
        ONE_SHOT=0; PERIODIC=1
        def __init__(self, *a, **k): pass
        def init(self, *a, **k): pass   # callbacks don't fire on the blocking sim
        def deinit(self): pass
    m.Timer=Timer

    class RTC:
        def __init__(self, *a, **k): pass
        def datetime(self, dt=None): return (2026,1,1,3,0,0,0,0)
        def init(self, *a, **k): pass
    m.RTC=RTC

    class WDT:
        def __init__(self, *a, **k): pass
        def feed(self): pass
    m.WDT=WDT

    def freq(f=None): return 125000000 if f is None else None
    def unique_id(): return b'SNAKIEsim'
    def reset(): pass
    def soft_reset(): pass
    def disable_irq(): return 0
    def enable_irq(state=0): pass
    def idle(): pass
    def lightsleep(*a): pass
    def deepsleep(*a): pass
    def bootloader(*a): pass
    for _n,_f in (('freq',freq),('unique_id',unique_id),('reset',reset),
                  ('soft_reset',soft_reset),('disable_irq',disable_irq),
                  ('enable_irq',enable_irq),('idle',idle),('lightsleep',lightsleep),
                  ('deepsleep',deepsleep),('bootloader',bootloader)):
        setattr(m,_n,_f)

    sys.modules['machine']=m

__snakie_install_machine()
del __snakie_install_machine
`
