Functions — name a block of code once, run it whenever you need it.

## def & return

```python
def celsius_to_f(c):
    return c * 9 / 5 + 32

print(celsius_to_f(21.5))    # 70.7
```

`return` hands a value back (and ends the function). Without one, a function
returns `None`.

## Default + keyword arguments

```python
def blink(pin, times=3, delay=0.2):
    for _ in range(times):
        pin.toggle()
        time.sleep(delay)

blink(led)                    # uses the defaults
blink(led, times=10)          # override by name
```

## Docstrings

```python
def read_average(adc, samples=8):
    """Mean of several ADC reads (smooths a noisy pot)."""
    return sum(adc.read_u16() for _ in range(samples)) / samples
```

## lambda — a tiny inline function

```python
by_second = sorted(pairs, key=lambda p: p[1])
```

## Scope: global & nonlocal

Assigning inside a function makes a NEW local name unless you say otherwise:

```python
count = 0

def tick():
    global count      # write the module-level variable
    count += 1
```

Prefer returning values over `global` — it keeps programs testable.
