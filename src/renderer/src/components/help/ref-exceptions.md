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
