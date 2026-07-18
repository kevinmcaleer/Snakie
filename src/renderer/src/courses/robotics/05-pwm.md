## Fading with PWM 💡

An LED is either on or off — so how do you make it *glow* softly? You blink it so fast your eyes can't see the flicker, only a dimmer light. That trick is called PWM.

Look at the starter code:

- `PWM(Pin(15))` turns pin 15 into a fast on/off pin.
- `led.freq(1000)` sets it to flick 1000 times a second.
- `led.duty_u16(duty)` sets brightness. `0` is off, `65535` is full glow, and anything in between is a dimmer shade.
- The `for` loop steps `duty` up in jumps of 4000, waiting 50ms each time — so the LED fades from dark to bright.

### Try it

1. Press Run ▶ (your simulated board auto-connects).
2. Open the **Board View** — find pin 15 and watch the LED brighten step by step.
3. Open the **Plotter** to see the duty value climb like a staircase.

### Now you

Make it fade *back down* too. Add a second loop after the first that counts the other way:

```python
for duty in range(65535, 0, -4000):
    led.duty_u16(duty)
    time.sleep_ms(50)
```

Now your LED breathes in and out.

> Smaller jumps than 4000 make a smoother, silkier fade — try 1000.
