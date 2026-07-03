Classes — bundle state + behaviour into your own types (every driver is one).

## Defining & using

```python
class Blinker:
    """An LED that remembers its own pin and count."""

    def __init__(self, pin_no):
        self.pin = Pin(pin_no, Pin.OUT)   # per-instance state
        self.count = 0

    def blink(self):
        self.pin.toggle()
        self.count += 1

b = Blinker(25)     # __init__ runs here
b.blink()
print(b.count)      # 1
```

`self` is the instance — every method takes it first, and per-object data
lives on it (`self.pin`).

## Properties — computed attributes

```python
class Thermometer:
    def __init__(self, adc):
        self._adc = adc

    @property
    def celsius(self):
        return 27 - ((self._adc.read_u16() * 3.3 / 65535) - 0.706) / 0.001721

t = Thermometer(ADC(4))
print(t.celsius)          # no parentheses — reads like a value
```

The BME280 driver's `.temperature` / `.pressure` / `.humidity` work this way.

## Inheritance

```python
class QuietBlinker(Blinker):
    def blink(self):
        super().blink()     # reuse the parent, then extend
```

Duck typing matters more than hierarchies in MicroPython: Snakie's
`inst.watch()` recognises objects purely by the methods they expose.
