UART is an async **serial** link: TX out, RX in, both sides set to the same **baudrate**. Great for GPS, modems, and board-to-board links.

## Create the port

```python
from machine import Pin, UART

uart = UART(0, baudrate=9600,
            tx=Pin(0), rx=Pin(1))
```

First arg is the UART number (`0`/`1`). Cross the wires: your **TX → their RX**, **RX → their TX**, and share **GND**.

## Send & receive

```python
uart.write("AT\r\n")

if uart.any():              # bytes waiting?
    line = uart.readline()  # or uart.read(n)
    print(line)
```

## Notes

- Both ends **must** match baudrate (9600 / 115200 …) or you get garbage.
- Logic is **3.3 V** — level-shift 5 V devices.
- `uart.read()` returns `bytes`; decode with `.decode()` for text.
