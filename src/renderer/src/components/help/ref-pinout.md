A **pinout** maps each physical pin to what it does: power, ground, and GPIOs (some doubling as I2C / SPI / UART / ADC). Code always refers to the **GPIO number**, not the physical pin position.

## Reading one

- **GND / 3V3 / VBUS(5V)** — power rails, never a signal
- **GPn** — general pin, usable as `Pin(n, ...)`
- **I2C0 SDA/SCL, SPI0 SCK…, UART0 TX/RX** — the bus each pin can join
- **ADCn** — pins that can read analog voltage

A pin can list several roles, but only one is active at a time.

## In Snakie

Open the **mini board view** and pick your board from the picker. It draws that board's full pinout and, as you write code, highlights the pads you're actually using and labels their bus role.

```python
# 'GP15' on the diagram → Pin(15) in code
led = Pin(15, Pin.OUT)
```

Always match the diagram's rails: signals to GPIOs, power to 3V3/5V, and share **GND**.
