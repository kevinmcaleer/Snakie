# Modulino Thermo

A Renesas **HS3003** temperature and relative-humidity sensor. It reads
−40 °C to +125 °C and 0–100 % RH, at ±0.25 °C and ±2.8 % RH, 14 bits each.

## Address — `0x44`, and it can't move

There's **no MCU** on this board; the HS3003 answers for itself, so the address
is fixed by the silicon. Unlike the modules with an MCU, it can't be changed in
software *or* by a solder jumper — which means **you can never have two Thermos
on one bus**. Two rooms means two buses (or a Modulino Hub).

Because it's the bare sensor, the address is also **not** shifted: `0x44` is what
the library asks for and `0x44` is what a scan reports.

## Wiring

A QWIIC socket at **each end**, both on the same bus in parallel — plug into
either and chain the next module off the other.

| Pin | What |
|---|---|
| GND | ground |
| 3V3 | 3.3 V |
| SDA | I²C data |
| SCL | I²C clock |

## Code

```python
from modulino import ModulinoThermo

thermo = ModulinoThermo()

print(thermo.temperature)        # °C
print(thermo.relative_humidity)  # % RH
```

| Property | Returns |
|---|---|
| `.temperature` | degrees Celsius |
| `.relative_humidity` | percent RH |
| `.measurements` | both at once, as a `Measurement` named tuple |

### Read both in one go

`.temperature` and `.relative_humidity` each trigger a **fresh** sensor read, so
asking for both separately costs two conversions and can hand you two readings
taken microseconds apart. `.measurements` gets them from one:

```python
from modulino import ModulinoThermo

thermo = ModulinoThermo()

m = thermo.measurements
print(m.temperature, m.relative_humidity)

t, rh = thermo.measurements     # it unpacks, too
```

### Handle `None`

If a conversion is still in flight the sensor reports stale data, and the driver
turns that into **`None`** rather than a wrong number. Check before you format,
or a `:.1f` will blow up on you:

```python
from modulino import ModulinoThermo
from time import sleep

thermo = ModulinoThermo()

while True:
    t, rh = thermo.measurements
    if t is not None:
        print(f"{t:.1f} °C, {rh:.1f} %")
    sleep(2)
```

The sensor self-heats slightly if you hammer it; a couple of seconds between
reads is plenty for room air, which moves slowly anyway.

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
from modulino import ModulinoThermo

# Use YOUR board's I²C pins — Snakie shows them on the board's pinout.
i2c = I2C(0, sda=Pin(4), scl=Pin(5))

thermo = ModulinoThermo(i2c_bus=i2c)
```

Every Modulino class takes `i2c_bus`, so one bus serves a whole chain — build it
once and pass it to each module.

## Install the library

One package covers every Modulino, and it pulls in the `micropython_hs3003`
driver this board needs as a dependency:

```python
mip.install("github:arduino/arduino-modulino-mpy")
```

Snakie offers this for you when you place a Modulino on the board — and only
once, however many Modulinos your design has.

## Modulino addresses

As they appear **in a bus scan**:

| Address | Module | Re-addressable? |
|---|---|---|
| `0x02` | Latch Relay | yes |
| `0x1E` | Buzzer | yes |
| `0x24` | Motors | yes |
| `0x29` | Distance | **no** — VL53L4CD |
| `0x2C` | Joystick | yes |
| `0x36` | Pixels | yes |
| `0x38` | Vibro | yes |
| `0x39` | LED Matrix | yes |
| `0x3A` / `0x3B` | Knob | yes |
| `0x3E` | Buttons | yes |
| `0x44` | **Thermo** | **no** — HS3003 |
| `0x53` | Light | **no** — LTR-381RGB-01 |
| `0x6A` / `0x6B` | Movement | solder jumper only |

Note `0x44` is a busy address — plenty of unrelated breakouts use it, so a scan
hit there isn't proof it's this board.

## Links

- [Product page](https://docs.arduino.cc/hardware/modulino-thermo/) (ABX00103)
- [MicroPython library](https://github.com/arduino/arduino-modulino-mpy)
