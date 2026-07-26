# Grove LED Bar

Ten LED segments — eight green, then orange, then red — driven by an **MY9221**
LED driver over a 2-wire clock/data interface on a Grove **digital** port.

## Not I²C

Despite having two signal lines, this is **not** an I²C device and will never
appear in an `i2c.scan()`. It's a shift-register-style protocol: you clock 16 bits
of command followed by 12 bits per channel, latching at the end.

**Contact 1 is the clock (`DCKI`), contact 2 is the data (`DI`).** Swapping them
is the usual reason a freshly wired bar lights nothing at all — there's no
acknowledgement to tell you it's backwards.

## Driving it

```python
from machine import Pin

class LedBar:
    def __init__(self, clk, data):
        self.clk = Pin(clk, Pin.OUT)
        self.dat = Pin(data, Pin.OUT)
        self._state = 0

    def _send16(self, bits):
        for i in range(15, -1, -1):
            self.dat.value((bits >> i) & 1)
            self.clk.value(not self.clk.value())   # MY9221 clocks on each edge

    def _latch(self):
        self.dat.low()
        for _ in range(4):
            self.dat.high()
            self.dat.low()

    def level(self, n):
        """Light the first n of 10 segments."""
        self._send16(0x0000)                       # command: 8-bit grayscale
        for i in range(12):
            self._send16(0xFF if i < n else 0x00)
        self._latch()

bar = LedBar(clk=26, data=27)
bar.level(7)
```

Twelve channels are clocked out even though only ten are populated — the MY9221
drives 12 and the last two go nowhere.

## Using it as a gauge

The colour run is deliberate: eight green, one orange, one red. It reads
naturally as a **level with a warning zone at the top**, so it suits distance,
battery state or a control-loop error far better than it suits a progress bar.
