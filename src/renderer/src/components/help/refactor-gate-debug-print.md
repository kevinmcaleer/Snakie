A print inside a tight loop blocks on the serial port every pass.

```python
# before                          # after (yours to write)
while True:                       DEBUG = False
    angle = read_angle()          …
    print("angle", angle)         while True:
    drive(angle * 4)                  angle = read_angle()
    sleep_ms(20)                      if DEBUG:
                                          print("angle", angle)
                                      drive(angle * 4)
                                      sleep_ms(20)
```

## Why it matters

on a microcontroller `print` is not free and it is not
asynchronous. It formats the arguments, then **blocks** until the bytes have
been pushed out of the UART or USB CDC — and if nothing is draining the other
end, it can block for a very long time. At 115200 baud a forty-character line
costs about 3.5 ms; drop that into a 20 ms control loop and a fifth of the
budget has gone to a debug message. This is the single most common reason a
beginner's balancing robot, line follower or PID loop "runs fine until I plug
it into the laptop" — and it is invisible in the code, because the same line
on a desktop costs nothing.

**Hint only.** Deleting someone's debugging is not a refactoring, and the
right fix depends on what they were debugging: a `DEBUG` flag, a counter that
prints every hundredth pass, or a value logged to a list and dumped after the
run. So Snakie declines and the "Why?" article does the teaching.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
