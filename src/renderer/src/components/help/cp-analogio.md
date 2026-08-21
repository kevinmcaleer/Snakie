Reading a voltage — a potentiometer, an LDR, a battery divider — is
`analogio.AnalogIn` on an analogue-capable pin (`board.A0`, `board.A1`, …).

## Reading

```python
import board
import analogio

pot = analogio.AnalogIn(board.A0)

print(pot.value)          # 0 – 65535
```

`value` is always scaled to a **16-bit** range whatever the chip's real ADC
resolution is, so the same code reads the same numbers on a 12-bit RP2040 and a
10-bit ATSAMD21.

## Volts

```python
volts = pot.value / 65535 * pot.reference_voltage
print(f"{volts:.2f} V")
```

`reference_voltage` is the full-scale voltage for that pin (3.3 on most boards),
so this works without hardcoding the reference.

## Writing a voltage

Boards with a true DAC (SAMD21/SAMD51, ESP32) can output one:

```python
import board
import analogio

dac = analogio.AnalogOut(board.A0)
dac.value = 32768         # about half of 3.3 V
```

That is a real analogue voltage, not PWM. Boards without a DAC raise
`AttributeError` — use `pwmio` and a filter instead.

## Notes

- Readings jitter by a few counts. Average several, or ignore changes smaller
  than a few hundred.
- One object per pin: `pot.deinit()` before another use of `board.A0`.
- Reading is the same 0–65535 range as MicroPython's `ADC.read_u16()`, so scaling
  maths ports across unchanged.
