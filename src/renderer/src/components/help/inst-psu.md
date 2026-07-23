An adjustable **bench power supply** for the Circuit Sim — set an output **voltage** and a **current limit**, switch the output on, and wire its terminals into your breadboard the way you would a real lab PSU.

## What it does
Two seven-segment lines show the output **voltage** (top) and **current** (bottom). Two sliders set the target voltage (0–30 V) and the current limit (0–5 A); the **OUTPUT** button arms or disarms the supply. A **CV / CC** annunciator shows the regulation mode — **CV** (constant voltage) is the normal state, **CC** (constant current) lights when a load pulls enough to hit the current limit.

## How to use it
Drop a **Bench Power Supply** part onto the board (or a battery pack from the Power family), wire its **V+ / GND** to your circuit, then set the voltage your parts expect:

- **3.3 V** logic / most sensors
- **5 V** for many displays and the Pico's VBUS rail
- **6–7.4 V** for motors and servos (via VBUS/VSYS, never the 3V3 regulator)

The **current limit** is your safety net: set it just above what the circuit should draw, and the supply folds back to **CC** instead of letting the magic smoke out.

- The live current readback and CC fold-back become real once the DC solver lands (Circuit Sim phase 3). Until then the display reflects your set-points so you can wire and reason about the supply.
- Batteries carry a fixed voltage + capacity; the bench PSU is the adjustable one.
