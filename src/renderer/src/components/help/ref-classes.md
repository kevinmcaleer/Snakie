Classes — bundle state + behaviour into your own types (every driver is one).

## Defining & using

```python
class Blinker:
    """An LED that remembers its own pin and count."""

    def __init__(self, led):
        self.led = led          # per-instance state: whatever your
        self.count = 0          # runtime's Pins page gave you
        self.on = False

    def blink(self):
        self.on = not self.on
        self.count += 1

b = Blinker(my_led)   # __init__ runs here
b.blink()
print(b.count)      # 1
```

`self` is the instance — every method takes it first, and per-object data
lives on it (`self.led`).

## Properties — computed attributes

```python
class Thermometer:
    def __init__(self, read_raw):
        self._read_raw = read_raw       # a function returning 0-65535

    @property
    def celsius(self):
        volts = self._read_raw() * 3.3 / 65535
        return 27 - (volts - 0.706) / 0.001721

t = Thermometer(sensor_reading)
print(t.celsius)          # no parentheses — reads like a value
```

The BME280 driver's `.temperature` / `.pressure` / `.humidity` work this way.

## Inheritance

```python
class QuietBlinker(Blinker):
    def blink(self):
        super().blink()     # reuse the parent, then extend
```

Duck typing matters more than hierarchies on a microcontroller: Snakie's
`inst.watch()` recognises objects purely by the methods they expose.
