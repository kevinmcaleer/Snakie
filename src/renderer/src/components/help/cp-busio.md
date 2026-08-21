I²C, SPI and UART all come from `busio`, built on pins from `board`.

## I²C — and the lock

CircuitPython shares the I²C bus with the display stack and with libraries, so
**you must take the lock** before talking to it directly:

```python
import board
import busio

i2c = busio.I2C(board.SCL, board.SDA)

while not i2c.try_lock():
    pass
try:
    print([hex(a) for a in i2c.scan()])
finally:
    i2c.unlock()
```

`try_lock()` returns `False` if something else has the bus — hence the loop — and
the `finally` guarantees you hand it back even if the scan raises. Forgetting
`unlock()` is what makes the *next* thing that touches the bus hang.

Snakie's **I²C Detect** instrument does this for you.

Shortcut: `i2c = board.I2C()` builds the same bus on the board's default pins,
and it's a **singleton** — every caller gets the same object, which is what
device libraries expect.

## Talking to a device

Most of the time you don't do this by hand — you hand the bus to a driver:

```python
import board
import adafruit_bme280.advanced as bme280

sensor = bme280.Adafruit_BME280_I2C(board.I2C())
print(sensor.temperature)
```

The library takes the lock when it needs it. Don't hold the lock yourself around
library calls, or they'll fail.

## SPI

```python
import board
import busio

spi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)

while not spi.try_lock():
    pass
try:
    spi.configure(baudrate=1_000_000, phase=0, polarity=0)
    spi.write(bytes([0x01, 0x02]))
finally:
    spi.unlock()
```

Chip-select is an ordinary `digitalio` output that you drive low yourself (or
hand to the driver).

## UART

```python
import board
import busio

uart = busio.UART(board.TX, board.RX, baudrate=9600, timeout=0.1)

uart.write(b"hello\n")
line = uart.readline()
```

No lock on UART — it isn't shared.

## Notes

- `busio` uses hardware peripherals and so is fussy about which pins can pair up.
  `bitbangio` will do any pins in software, more slowly.
- On many boards the USB serial console is *not* `board.TX`/`board.RX` — those are
  a separate physical UART.
