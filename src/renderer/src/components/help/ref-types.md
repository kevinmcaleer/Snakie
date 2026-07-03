Values and their types — what your variables hold.

## Numbers

```python
n = 42               # int (arbitrary precision)
duty = 0.75          # float
addr = 0x3C          # hex int (I2C addresses read naturally)
mask = 0b1010        # binary int
big = int("123")     # convert a string
level = float("0.5")
```

## Strings

```python
name = "Snakie"
msg = f"hello {name}, temp={21.5:.1f}"   # f-string formatting
line = "gp0,gp1".split(",")              # -> ['gp0', 'gp1']
n = int("42")                            # str -> int
```

## bool & None

```python
ready = True
missing = None            # "no value"
if reading is None: ...   # test with `is`
```

## Collections

```python
pins = [0, 1, 4, 5]              # list  — ordered, mutable
pins.append(12)
point = (3, 7)                   # tuple — ordered, IMMUTABLE (a, b = point)
config = {"sda": 12, "scl": 13}  # dict  — key -> value
config["freq"] = 100_000
seen = {0x3C, 0x68}              # set   — unique members
```

## bytes & bytearray

Binary data for buses and files — what `I2C.readfrom` returns:

```python
data = bytes([0x00, 0xFF])
buf = bytearray(8)          # mutable, fixed length
i2c.readfrom_into(0x68, buf)
value = buf[0] << 8 | buf[1]
```

## Checking a type

```python
type(42)                 # <class 'int'>
isinstance(x, float)     # True / False
```
