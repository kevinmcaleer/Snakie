## See your board 🔌

Code tells your board what to do — but where does pin 15 actually live? The **Board View** draws your wiring so you can see it, not just imagine it.

Your starter code lights up a pin:

- `from machine import Pin` brings in the tool for talking to pins.
- `led = Pin(15, Pin.OUT)` says "pin 15 is an output" — it sends power out.
- `led.on()` switches that pin on, like flicking a light switch.

### Try it

1. Press **Run** ▶ (your simulated board connects on its own).
2. Open the **Board View** from the side panel.
3. Find **pin 15** on the drawing — spot the little wire and LED that Snakie has sketched for you.
4. See how it lights up? That picture matches your code exactly.

### Now you

Change `Pin(15, Pin.OUT)` to a different number, like `Pin(16, Pin.OUT)`, and press **Run** again. Watch the Board View jump to the new pin. Which pins can you reach?

> The Board View is a mirror of your code — change a number, and the wiring redraws itself. No screwdriver needed!
