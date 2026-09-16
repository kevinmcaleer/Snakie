# Read a button

A blinking light is your program talking. A button is your program *listening*.

> **forever** — **if button on GP14 is pressed** — **print "Pressed!"**

## The pull-up, and why it's on the block

Look at the button block. It says **pull up**, and that is not decoration.

A pin with nothing connected doesn't read 0 or 1 — it reads whatever electrical
noise is nearby, which is why a button that "doesn't work" is nearly always this.
A **pull-up** resistor holds the pin at 1 when the button is *not* pressed, so
pressing it pulls the pin down to 0.

Which is why the Python on the right says:

```python
if not pin_14.value():
```

**not** — pressed means *zero*. Odd the first time, obvious ever after.

## Try it

Press **Run**, then press your button. If you have no board, the simulator's pin
reads high, so nothing prints — that is the pull-up doing its job.
