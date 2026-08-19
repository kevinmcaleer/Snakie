# Modulino Latch Relay

A **bistable latching relay** — an HFE60/3-1HT-L2 with two coils. A pulse on the
SET coil closes it, a pulse on the RESET coil opens it, and in between it draws
**no coil current at all**. Cut the power and it stays exactly where you left it,
which is the whole point of the thing: a normal relay drops out when the board
reboots, this one doesn't.

## Safety — DC only, 30 V maximum

**This board is NOT safe for switching AC loads.** Arduino's datasheet says so in
capitals, and it means mains too. It is a **DC-only** relay.

| | |
|---|---|
| Maximum switching voltage | **30 V DC** |
| AC loads | **not rated — do not** |
| Coil | 3 V nominal; ~100 mA for 50 ms while it flips, 0 mA once latched |

Because the state survives a power cut, a load left switched **on** stays on
while your board is off, reflashing, or crashed. Design for that: it's the
feature, but it's also the failure mode.

## Address — `0x02`

There's an MCU on this one, so the address is **software-configurable** — which
is how you run two Latch Relays on one chain.

`0x02` sits inside the range I²C reserves (`0x00`–`0x07`), so it's worth saying
plainly that this is not a typo. Arduino's own address-changer utility documents
the rule as *"default address is half pinstrap"* and names pinstrap `0x04` as the
Latch Relay, giving `0x02`; a scan of a real one on the Arduino forum reported
exactly that. Snakie's I²C-detect will still flag `0x02` as a reserved address —
that warning is correct in general, and this board is the exception.

Arduino's **datasheet** for this module instead prints `0x2A` / `0x15` in its
address table. That contradicts the library, the store page and the observed
scan, and the same datasheet table is demonstrably wrong for several other
Modulinos, so it hasn't been followed here.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel — plug into
either and chain the next module off the other. The switched load goes to the
relay's own screw terminals, not to these.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

## Code

```python
from modulino import ModulinoLatchRelay
from time import sleep_ms

relay = ModulinoLatchRelay()

relay.on()
sleep_ms(150)      # let the contacts settle before reading back
print(relay.is_on)
relay.off()
```

| Member | What |
|---|---|
| `.on()` | pulse the SET coil — contacts close |
| `.off()` | pulse the RESET coil — contacts open |
| `.is_on` | `True`, `False`, or **`None`** |

### That `None`

`.is_on` returns `None` when the board can't tell you — it has been powered up
but not commanded, so the relay is sitting in whatever position it was left in
and the firmware has no record of which. It is a real answer, not an error:

```python
state = relay.is_on
if state is None:
    print("unknown — latched from before the power cut")
```

Give it ~150 ms after `.on()` / `.off()` before reading back; the contacts are
mechanical and the read beats them otherwise.

## On a non-Arduino board, pass the I²C bus yourself

The library works out which pins carry I²C from `os.uname().machine`, against a
table of **Arduino** boards. On anything else — a Pico, a Tiny 2350, an ESP32 —
that lookup fails and construction raises:

```
RuntimeError: I2C interface couldn't be determined automatically for '<your board>'
```

It isn't a wiring fault, and nothing is wrong with the module. Hand it a bus and
it works:

```python
from machine import I2C, Pin
from modulino import ModulinoLatchRelay

# Use YOUR board's I²C pins — Snakie shows them on the board's pinout.
i2c = I2C(0, sda=Pin(4), scl=Pin(5))

relay = ModulinoLatchRelay(i2c_bus=i2c)
```

Every Modulino class takes `i2c_bus`, so one bus serves a whole chain — build it
once and pass it to each module.

## Install the library

One package covers every Modulino:

```python
mip.install("github:arduino/arduino-modulino-mpy")
```

Snakie offers this for you when you place a Modulino on the board — and only
once, however many Modulinos your design has.

## Modulino addresses

As they appear **in a bus scan**:

| Address | Module | Re-addressable? |
|---|---|---|
| `0x02` | **Latch Relay** | yes |
| `0x1E` | Buzzer | yes |
| `0x24` | Motors | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x2C` | Joystick | yes |
| `0x36` | Pixels | yes |
| `0x38` | Vibro | yes |
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | Thermo | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | solder jumper only |

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-latch/) (ABX00138)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
