Errors & exceptions — hardware misbehaves; `try` keeps your program alive.

## try / except

```python
try:
    bme = BME280(i2c)
except OSError as e:
    print("sensor not responding:", e)
    bme = None
```

`OSError` is the one you'll meet most on hardware — a missing/unwired I2C
device, a failed file operation ([Errno 5] EIO means the bus transfer failed).

## finally — always runs

```python
try:
    f = open("log.txt", "w")
    f.write("hello")
finally:
    f.close()      # runs even if write() blew up
```

## raise — signal your own errors

```python
def set_angle(deg):
    if not 0 <= deg <= 180:
        raise ValueError("angle must be 0-180")
```

## Be specific

Catch the narrowest error you can, and keep the `try` block small:

```python
try:
    value = int(text)
except ValueError:
    value = 0
```

A bare `except:` hides real bugs (including Ctrl-C!) — avoid it.

## In blocks

Control ▸ **When things go wrong** has the two blocks for all of this.

**try to … / if that goes wrong …** is Python's `try` / `except`. The block says
what it means; the mirror beside it shows the words Python uses, which is the
translation you will need the day you write this out by hand.

```
try to
    ask the sensor for a reading
if that goes wrong  [OSError]
    say "sensor not answering"
```

```python
try:
    reading = sensor.read()
except OSError:
    print('sensor not answering')
```

- The **box after "if that goes wrong"** is the *kind* of problem to catch.
  `OSError` is what an unplugged or unresponsive sensor raises; `ValueError` is
  what `int("hello")` raises; `KeyboardInterrupt` is Ctrl-C.
- **Leave it empty and you catch everything**, Ctrl-C included — which makes a
  program you cannot stop. The block arrives with `OSError` already in it for
  that reason. Fill it in with something.
- The **+** button adds another "if that goes wrong", so you can answer two
  kinds of problem differently.
- The two ticks at the foot of the block show the other two arms: **if nothing
  went wrong** (Python's `else`, which runs only when the `try` part finished)
  and **either way, afterwards** (Python's `finally`, which runs however the
  block ended — the one you want for turning a motor off).

**report a problem** is Python's `raise`. Use it when your own code has been
asked to do something impossible, and leave its socket empty inside an
"if that goes wrong" to pass the problem on up.

### Why this matters on a board

A robot whose distance sensor comes unplugged should slow down and say so, not
stop dead with a traceback nobody is there to read. And `while True:` loops are
how nearly every hardware program is written — catching `KeyboardInterrupt` is
how you get out of one cleanly, stopping the motors on your way.
