## Talking to pins 💡

Your board has little metal legs called **pins**. `Pin` lets your code switch one on or off, like flicking a light switch.

The starter code, one line at a time:

- `from machine import Pin` — borrows the `Pin` tool from MicroPython.
- `Pin(25, Pin.OUT)` — picks pin number **25** and sets it to **OUT** (it *sends* signals, like a switch, instead of listening).
- `led.on()` — pushes the pin high, turning it on.
- `led.value()` — asks the pin how it feels right now: `1` for on, `0` for off.

### Try it

1. Make sure your simulated board is connected (Snakie auto-connects it).
2. Press **Run ▶**.
3. Read the console — it should say `LED value: 1`.
4. Open the **Board View** to see pin 25 light up on the drawing.

### Now you

Add a new line after `led.on()`:

```python
led.off()
print("Now:", led.value())
```

Run again. Did the second number drop to `0`? You just turned your pin back off.

> `on()` and `off()` are just friendly words for the numbers `1` and `0` — the board only ever thinks in on/off.
