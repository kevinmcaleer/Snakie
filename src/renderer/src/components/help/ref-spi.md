SPI is a fast, **four-wire** bus: SCK (clock), MOSI (out), MISO (in), plus a **CS** (chip-select) per device.

## Create the bus

```python
from machine import Pin, SPI

spi = SPI(0, baudrate=1_000_000,
          sck=Pin(2), mosi=Pin(3), miso=Pin(4))
cs = Pin(5, Pin.OUT, value=1)   # idle high
```

The first arg is the **bus number** (`0`/`1`); valid SCK/MOSI/MISO pins depend on the board — check the pinout.

## Talk to a device

Pull CS **low** for the transaction, then high again:

```python
cs.value(0)
spi.write(b"\x9f")        # command
resp = spi.read(3)        # clock in 3 bytes
cs.value(1)
```

## Notes

- Write-only? Skip `miso`. Displays often add a **DC** pin (data/command).
- Each peripheral needs its **own CS** pin; SCK/MOSI/MISO are shared.
