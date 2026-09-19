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
def read_average(read, samples=8):
    """Mean of several sensor reads (smooths a noisy pot)."""
    return sum(read() for _ in range(samples)) / samples
```

Passing the *reading function* in rather than the sensor keeps this portable —
call it with whatever your runtime's analogue page gives you.

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

## Parameters with a default, and `*args`

A `def` block's parameter list — the one behind the little gear — holds plain
names, because each one becomes a variable you can drag around inside the
function, and renaming one renames it in every call.

Some parameters cannot be a plain name:

```python
def blink(pin, times=3):        # a default
def __init__(self, *args, **kwargs):   # any number of them
```

Those go in the block's **and also** box, after the ones above it, written
exactly as Python wants them: `times=3`, or `*args, **kwargs`.

A parameter with a default is **optional** when the function is called, which
is why it does not get a socket on the caller block — `blink(15)` is a complete
call, and `blink(15, 5)` overrides the default. That is the whole point of
giving it one.

### Defaults are worked out once

`def add(item, to=[])` does not start with a fresh empty list every call — it
reuses the *same* list for ever, which is one of the oldest traps in Python.
Keep defaults to simple values: a number, a piece of text, `True`, `False`,
`None`.

## Naming an argument when you call something

Library functions often take settings by name:

```python
pixels.fill(colour=RED)
display.text('hello', x=0, y=0)
```

The **call** block in the Python drawer has a small box before each argument
socket. Leave it empty and the argument is positional, as usual; type a name
into it and Python gets `name=value`.

**spread** and **spread by name** hand a whole list or a whole dictionary over
as arguments — `f(*values)` and `f(**settings)`. They only mean anything in an
argument socket; `x = *values` is not a thing.

## Building on another class

**the class this one is built on** is Python's `super()`. Call a method on it
to run the version your class replaced — which is how a subclass's setup runs
its parent's first:

```python
class Rover(Wheels):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
```
