A skeuomorphic display that both **mirrors** and **drives** a screen — an **I²C** SSD1306/SH1106 OLED (or HD44780 character LCD) *or* an **SPI ST7789** colour TFT.

## Two modes
- **Mirror** — renders whatever the board prints as `SNK SCR …` (text rows or a framebuffer), live, with an FPS readout.
- **Push** — type rows and send them to the real panel over the control channel (`SNKCMD screen text …`).

## Pick a size, pick a bus
The **SIZE** picker sets both the geometry and the bus. Choosing an **OLED/LCD** shows the **I²C** wiring (SDA / SCL / ADDR); choosing a **TFT** (240×240, 240×320, 135×240, 170×320) swaps to the **SPI** wiring — **SCK · SDA(MOSI) · DC · RST · CS** (CS can be set to **tied** if it's wired low). Each selector retargets the live display; SCK+MOSI must be a valid RP2040 SPI pair (the panel warns otherwise). The bottom strip reads **ADDR/BUS · SIZE · FPS**.

## How to use it
Mirror works from any program that calls `inst.display.text([...])`. To retarget pins or **Push**, a program must be running and servicing control — start it with the display's pins and poll each loop:

```python
import instruments as inst

# I²C SSD1306:
inst.start(screen_sda=0, screen_scl=1)               # I2C0 SSD1306 @ 0x3C
# …or an SPI ST7789 240×240 (CS tied low → screen_cs=None):
inst.start(screen_sck=18, screen_mosi=19, screen_dc=16,
           screen_rst=20, screen_cs=17, screen_w=240, screen_h=240)

while True:
    inst.display.text(["Hello,", "Snakie!"])
    inst.control.poll()
```

No program running? The panel offers **Run display demo** (I²C) or **Run ST7789 demo** (SPI).
