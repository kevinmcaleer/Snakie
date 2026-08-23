A viper int is a raw machine word — this arithmetic can overflow with no error at all.

```python
@micropython.viper
def total_counts(buf, count: int) -> int:
    total = 0
    for i in range(count):
        total += int(buf[i])   # <- no overflow check lives here
    return total
```

## Why it matters

A viper `int` is not a Python integer. Python integers are
arbitrary precision — they grow as large as the number needs and the heap
allows, which is why `2 ** 100` just works. A viper `int` is a **raw machine
word**: 32 bits on every board Snakie targets, held in a CPU register. That is
the whole reason viper is fast, and it is the whole reason this warning
exists.

There is no overflow check. None. When a multiply, a shift or an accumulator
crosses `2**31` the value does not raise, does not saturate and does not warn
— it wraps to a negative number and the function carries on as if nothing
happened. A step counter that reads 2,147,483,647 one second and
−2,147,483,648 the next. A checksum that matches on short packets and fails on
long ones. A fixed-point multiply that puts the robot into reverse at exactly
the wrong throttle. These are hours-long bugs precisely because the code looks
right, the maths looks right, and Python has spent your whole career making
this class of bug impossible.

What to do about it, in rough order of preference:

- **Bound the inputs.** Mask intermediate results (`& 0xFFFF`), or shift down
  before you multiply up, so the widest value the expression can produce still
  fits in 31 bits and a sign bit. A masked result is not reported here.
- **Reset the accumulator.** A running total that is drained every loop
  iteration cannot climb; one that runs for hours will.
- **Keep a plain-Python fallback.** Do the narrow, hot case in viper and hand
  the wide case to an undecorated function, where Python's arbitrary precision
  is waiting for you. Two functions is not a failure; it is the honest shape
  of "fast when it can be, correct always".

This one never rewrites anything. Which bound is right for your data is not
something a refactoring tool can know, and quietly inserting a mask would be a
behaviour change dressed up as a fix.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
