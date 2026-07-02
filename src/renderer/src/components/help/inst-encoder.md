A live view of a rotary encoder — a knurled knob that turns to the running count.

## What it shows
The knob rotates to the encoder **count**, with a **CW/CCW** direction lamp and a **Δ** step readout. The bottom strip is **COUNT / DIR / RPM** — or **COUNT / DIR / BUTTON** once the encoder reports a push-switch. It reads `SNK ENC <ch> <count> [<pressed>]` non-invasively (last value wins per channel).

## How to use it
Read your encoder's count (A/B pins) and, optionally, its shaft switch, then emit it each loop with `inst.encoder(count, ch=..., pressed=...)`. Omit `pressed` for an encoder with no button.

```python
import instruments as inst

count = enc.value()          # your encoder's running count
inst.encoder(count, ch="enc", pressed=sw.value() == 0)
```
