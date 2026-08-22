This handler throws the error away — log it, re-raise it, or handle it.

```python
try:
    imu.calibrate()
except:
    pass          # ← the robot now drives on uncalibrated, and nothing said so
```

This is the silent-failure half of "Catch a specific exception". A handler whose entire body is
`pass` throws the error away: the sensor never initialised, the file never
saved, the I2C device was never there — and the program carries on as though
it worked. Debugging that costs an evening, because the one piece of evidence
was deleted at the moment it was produced.

**Hint only, on purpose.** There are three good fixes and no way to tell from
the code which one is meant:

- `print("no IMU:", err)` — carry on, but say so;
- `raise` — this level cannot handle it, let the caller decide;
- handle it properly — fall back to a default, retry, light the error LED.

Guessing would be worse than asking, so Snakie leaves the code alone and the preview
shows the explanation instead of a diff.

A handler carrying a comment is left alone: `except OSError:  # display is
optional` is a decision someone wrote down, not an oversight.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
