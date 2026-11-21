- **CircuitPython code runs on the simulator.** The simulated board now has
  CircuitPython's hardware modules (`board`, `digitalio`, `pwmio`, `analogio`,
  `busio`, `microcontroller`, `supervisor`) and `time.monotonic()`, built on
  the same simulated pins as MicroPython's `machine`. A CircuitPython blink or
  motor sketch runs offline, and the mini board labels `board.GP0`-style pins
  the way it labels `Pin(0)`.
