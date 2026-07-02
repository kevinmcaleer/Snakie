A skeuomorphic SSD1306 OLED that both **mirrors** and **drives** an I²C display.

## Two modes
- **Mirror** — renders whatever the board prints as `SNK SCR …` (text rows or a framebuffer), live, with an FPS readout.
- **Push** — type rows and send them to the real panel over the control channel (`SNKCMD screen text …`).

SDA / SCL / ADDR selectors retarget the display; the bottom strip reads **ADDR / SIZE / FPS**.

## How to use it
Mirror works from any program that calls `inst.screen([...])`. To retarget pins or **Push**, a program must be running and servicing control — start it with the SDA/SCL pins and poll each loop:

```python
import instruments as inst

inst.start(screen_sda=0, screen_scl=1)  # I2C0 SSD1306 @ 0x3C
while True:
    inst.screen(["Hello,", "Snakie!"])
    inst.control.poll()
```

No program running? The panel offers **Run display demo**.
