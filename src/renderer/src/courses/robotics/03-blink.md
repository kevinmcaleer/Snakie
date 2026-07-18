## Blink an LED 💡

Making a light flash on and off is the "hello world" of robots. Let's tell your board's LED to wink at you.

The starter code, one idea at a time:

- `Pin(15, Pin.OUT)` grabs pin **15** and sets it to **OUT**, so the board sends power *out* to the LED.
- `while True:` means "keep doing this forever".
- `led.toggle()` flips the LED. The tip says it swaps on↔off each loop — so on, off, on, off, like a light switch you can't stop pressing.
- `time.sleep_ms(400)` waits 400 milliseconds (a bit under half a second) between flips. That pause is what makes it *blink* instead of blur.

### Try it

1. Press **Run ▶**. Your simulated board auto-connects.
2. Open the **Board View** and find pin 15 — watch the LED there pulse on and off.
3. Count the beats. Roughly one flash every second.

### Now you

Make it flash faster. Change `400` to `100`:

```python
time.sleep_ms(100)
```

Press Run again. Now try a slow, sleepy `1000`. Which one feels like a heartbeat?

> The pause is the secret. Without `sleep_ms`, the LED flips so fast it just looks *on*.
