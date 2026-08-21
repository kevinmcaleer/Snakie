On CircuitPython you never type a GPIO number. Every pin is an **object** on the
`board` module, named after the label printed on the board itself.

```python
import board

led = board.LED
sda = board.SDA
```

## What does *this* board have?

`board` is different on every board — a Feather has `board.D13`, a QT Py has
`board.A0`, and neither has the other's pins. Ask the board rather than guessing:

```python
import board

print(dir(board))
```

Run that in the REPL below and you get the exact list for the board in your hand.

## Names you'll usually find

| Name | What it is |
|---|---|
| `board.LED` | the onboard LED, if there is one |
| `board.D0`, `board.D1`, … | digital pins, by silkscreen number |
| `board.A0`, `board.A1`, … | analogue-capable pins |
| `board.SDA`, `board.SCL` | the default I²C pair |
| `board.SCK`, `board.MOSI`, `board.MISO` | the default SPI pins |
| `board.TX`, `board.RX` | the default UART pins |
| `board.NEOPIXEL` | the onboard RGB pixel, if there is one |

## Shortcuts for the default buses

`board` will build the standard buses for you, on the right pins, without you
naming them:

```python
import board

i2c = board.I2C()      # same as busio.I2C(board.SCL, board.SDA)
spi = board.SPI()
uart = board.UART()
```

## Notes

- A pin object can only be used by **one** thing at a time. Call `.deinit()` on
  whatever holds it before handing it to something else, or you'll get
  `ValueError: <pin> in use`.
- `microcontroller.pin` reaches pins the board doesn't name (`microcontroller.pin.GPIO15`)
  — useful on a custom board, but `board` names are the portable choice.
- `board.board_id` prints this build's board id, the same string that appears in
  `boot_out.txt` on the CIRCUITPY drive.
