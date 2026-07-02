A music player for a piezo buzzer on a PWM pin — a one-octave piano, an editable melody sequencer, a musical staff, and an RTTTL ringtone box.

## What it does
Clicking a key sounds it (WebAudio in the IDE **and** on the board); **Shift-click** appends it to the melody. ▶ Play streams one compact `buzzer seq …` line; keys/STOP/VOLUME/PIN write `tone <freq> <ms>` / `stop` / `vol` / `pin <n>` via `sendControl('buzzer', …)`. Export/Paste-to-code drop runnable MicroPython.

## How to use it
Pick the **PIN (PWM)**, then run a program that opens the buzzer receiver (▶ Play offers to run a demo if none is live):

```python
import instruments as inst, time

inst.start(buzzer_pin=15)   # attach on GP15
while True:
    inst.control.poll()     # Play → buzzer sounds
    time.sleep(0.02)
```

- No board? Keys still preview audibly in the IDE.
