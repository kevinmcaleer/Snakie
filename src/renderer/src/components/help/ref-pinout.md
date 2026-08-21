A **pinout** maps each physical pin to what it does: power, ground, and GPIOs (some doubling as I2C / SPI / UART / ADC). Code never refers to the physical pin *position* — it uses the pin's name on the diagram.

## Reading one

- **GND / 3V3 / VBUS(5V)** — power rails, never a signal
- **GPn** — a general-purpose pin
- **I2C0 SDA/SCL, SPI0 SCK…, UART0 TX/RX** — the bus each pin can join
- **ADCn** — pins that can read analog voltage

A pin can list several roles, but only one is active at a time.

## From the diagram to your code

| Runtime | `GP15` on the diagram becomes |
|---|---|
| MicroPython | the GPIO **number** — see "Pins & GPIO" |
| CircuitPython | an object on `board` — see "board — this board's pins" |

Either way it's the same physical pad; only the spelling changes.

## In Snakie

Open the **mini board view** and pick your board from the picker. It draws that board's full pinout and, as you write code, highlights the pads you're actually using and labels their bus role.

Always match the diagram's rails: signals to GPIOs, power to 3V3/5V, and share **GND**.
