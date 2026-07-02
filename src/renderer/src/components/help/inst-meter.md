A skeuomorphic handheld DMM that reads an ADC pin as a voltage.

## What it shows
A 7-segment LCD voltage, a 0–3.3 V bargraph with the raw 12-bit count, and rolling **MIN / MAX / AVG** stats. Prefers passive `SNK METER` telemetry when present (no raw count then, shown as `----`); otherwise a REPL-polled sample. Pick another ADC pin with the source selector.

## How to use it
Opens per ADC pin from the board view. On the board, call `read_adc()` on a `machine.ADC` — it converts `read_u16()` to volts against a 3.3 V reference, emits `SNK METER <ch> <volts> V`, and returns the volts.

## Snippet
```python
from machine import ADC
import instruments as inst

adc = ADC(26)
while True:
    v = inst.read_adc(adc, ch="adc0")
```
