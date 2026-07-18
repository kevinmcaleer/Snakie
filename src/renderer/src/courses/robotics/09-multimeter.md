## The multimeter 🔌

A multimeter measures voltage — how hard electricity is being "pushed". Your board can read a voltage on a pin and show it on a dial, just like a real one.

The starter code turns pin **26** into an ADC (that's an *analog-to-digital converter*, a pin that reads voltages instead of just on/off):

- `pin.read_u16()` gives a big number from 0 to 65535.
- We do the maths to turn that into **volts** (0 V up to 3.3 V).
- Each line prints `SNK METER volts` — that special tag is what feeds the on-screen Multimeter needle.

### Try it

1. Make sure the simulated device is **Connected** (it auto-connects — look for the green dot).
2. Press **Run ▶**.
3. Open the **Multimeter** instrument. Watch the needle settle on a voltage.
4. In the **Board View**, find pin 26 — that's the pin you're measuring.

### Now you

Change the sleep to `time.sleep_ms(50)` so it reads faster, then round to `round(volts, 3)` for extra decimal places. Does the needle wobble more?

> A multimeter is a maker's most-used tool — if a wire is dead or a battery is flat, the voltage tells you first.
