Most of what you know carries over: it's the same Python, the same `while True:`,
the same `print()`. What changes is the **hardware layer** — and it changes at
the very first line, which is why a MicroPython tutorial fails immediately on a
CircuitPython board.

## The translation table

| | MicroPython | CircuitPython |
|---|---|---|
| **Naming a pin** | `Pin(25)` — the GPIO number | `board.D13` — the silkscreen name, from `board` |
| **Digital output (an LED)** | `machine` — `Pin(15, Pin.OUT)`, `led.value(1)` | `board` + `digitalio` — `DigitalInOut(board.D15)`, `led.value = True` |
| **Digital input (a button)** | `machine` — `Pin(14, Pin.IN, Pin.PULL_UP)` | `board` + `digitalio` — `btn.switch_to_input(pull=Pull.UP)` |
| **Analogue input** | `machine` — `ADC(26).read_u16()` | `board` + `analogio` — `AnalogIn(board.A0).value` |
| **PWM (dimming, servos, tones)** | `machine` — `PWM(Pin(15))`, `duty_u16(x)` | `board` + `pwmio` — `PWMOut(board.D15)`, `duty_cycle = x` |
| **I²C** | `machine` — `I2C(0, scl=…, sda=…)` | `board` + `busio` — `I2C(board.SCL, board.SDA)` + `try_lock()` |
| **SPI** | `machine` — `SPI(0, sck=…, mosi=…)` | `board` + `busio` — `SPI(board.SCK, MOSI=…)` |
| **UART (serial)** | `machine` — `UART(0, 115200, tx=…, rx=…)` | `board` + `busio` — `UART(board.TX, board.RX)` |
| **Waiting** | `time` — `sleep_ms(500)`, `ticks_ms()` | `time` — `sleep(0.5)`, `monotonic()` |
| **The program that runs at boot** | `main.py`, after `boot.py` | `code.py`, re-run on every save |
| **Installing a library** | `mip.install('name')`, on the board | the Adafruit bundle, copied into `/lib` |

## The five that actually catch people

**`value` is an attribute.** `led.value = True`, not `led.value(True)`. Calling it
gives `TypeError: 'bool' object is not callable`.

**There is no `sleep_ms`.** `time.sleep()` takes seconds as a float:
`sleep_ms(250)` becomes `sleep(0.25)`.

**I²C needs a lock.** `try_lock()` before `scan()`, `unlock()` after — the bus is
shared with the display and USB stacks. Libraries do it themselves; only lock it
by hand when you're driving the bus by hand.

**The filesystem is read-only to your code** while the computer has CIRCUITPY
mounted. `open("log.csv", "w")` from `code.py` gives `OSError: [Errno 30]`. See
"The read-only filesystem".

**Saving restarts your program.** There is no run button on the board — writing a
file *is* running it.

## What stays the same

`print()`, exceptions and tracebacks, `import`, classes, f-strings, `math`,
`json`, `struct`, `random`, `os` and the REPL all behave as you expect. Snakie's
editor, file tree and terminal work the same way on both.

## What doesn't exist on CircuitPython

`machine`, `micropython`, `mip`, `uasyncio` (it's `asyncio` from the bundle),
`network` (it's `wifi` + `socketpool`), `rp2`/`esp32`, `framebuf` (it's
`displayio`), `time.sleep_ms`/`ticks_ms`, and `machine.Timer`.
