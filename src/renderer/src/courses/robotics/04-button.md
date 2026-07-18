## Read a button 🔘

Buttons let your robot listen to *you*. This code watches a pin and shouts back the moment you press.

Here's what the starter code does:

- `Pin(14, Pin.IN, ...)` sets pin **14** as an **input** — it listens instead of sending power.
- `Pin.PULL_UP` keeps the pin resting at **1**. When you press the button, it drops to **0**.
- The `while True` loop checks the button over and over, super fast.
- `if button.value() == 0:` means "if it's pressed right now, print `Pressed!`".

Why the "pull-up"? Without it, an unpressed pin floats and reads random junk. The pull-up gently holds it at 1 so 0 always means "pressed on purpose".

### Try it

1. Let the simulated device **Connect** (it does this on its own).
2. Press **Run ▶**.
3. Open the **Board View** and find your button on pin **14**.
4. Click the button in the Board View and watch the **console** fill with `Pressed!`.

### Now you

Change the message to something fun, like `print("Ouch! You poked me!")`. Run it and press again.

> A `while True` loop that checks a button is your robot's way of waiting patiently for you.
