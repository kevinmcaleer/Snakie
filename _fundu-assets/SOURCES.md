# FunduMoto L298P motor driver shield — raw assets

Downloaded 2026-11-06. All images are third-party retailer/forum product photos with no licence stated —
treat as © their owners, **reference only** (trace/redraw for the catalog part, don't ship as-is).

Board identity: blue shield, silkscreen "FunduMoto" + "Keyes_L298P", ST L298P (PowerSO-20), white SERVO
header (G/+5/9), yellow Ping header (+/R/T/G), blue RGB header (B/G/-/R), black BT2 + 2x4 "bluetooth"
header, buzzer, 2-pin motor power terminal + 4-pin MOTORA/MOTORB terminal, red/white analog A0-A5 headers.

## Files

| File | Source URL | Pixels | Notes |
|---|---|---|---|
| top-protosupplies.jpg | https://protosupplies.com/wp-content/uploads/2018/05/L298P-Dual-Motor-Driver-Shield.jpg | 800×600 | **Angled 3/4 view**, not flat; ProtoSupplies watermark bottom-right |
| top-protosupplies-cutout.png | rmbg of the above | 800×600 | watermark excluded by mask |
| top-2.jpg | https://cdn.myshoptet.com/usr/www.laskakit.cz/user/shop/big/1364-2_foto-3.jpg | 1024×768 | **Best asset: real flat top-down photo**, white bg (laskakit.cz, Keyes 2-ch L298P) |
| top-2-cutout.png | rmbg of top-2.jpg | 1024×768 | board bbox 163,127 → 853,658 (~690×531 px) |
| top-3-render.png | cropped from pinout-3-render.png (y 0–590) | 780×590 | flat top-down **render/illustration**, not a photo; very legible silkscreen |
| top-3-render-cutout.png | white flood-fill (rmbg found no subject on the flat render) | 780×590 | board bbox 24,33 → 746,583 |
| back-2.jpg | https://cdn.myshoptet.com/usr/www.laskakit.cz/user/shop/big/1364-3_foto-4.jpg | 1024×768 | flat bottom view, white bg |
| pinout-1.jpg | https://cdn.myshoptet.com/usr/www.laskakit.cz/user/shop/big/1364-7_keyes-2-kanalovy-motor-driver-shield-l298p.jpg | 1024×768 | Keyes labelled pinout diagram (servo D9, ping D7, PWM 3/5/6, BT RX/TX, NO.2 pin, A0–A5) |
| pinout-2.png | https://makerselectronics.com/wp-content/uploads/2017/06/FAZYRSLL7924Z09.webp (converted to PNG) | 620×517 | annotated top-down photo naming every connector (motor power, servo, ultrasonic, RGB, buzzer, BT, sensor, reset, power jumper) |
| pinout-3-render.png | https://europe1.discourse-cdn.com/arduino/original/4X/e/1/5/e152366e9b7e44198b63a8d318e51c1e162b9c17.png | 780×780 | from Arduino forum thread https://forum.arduino.cc/t/fundumoto-l298p-shield/385824 ; render + "Motor Shield L298P" caption |

## Not obtained
- `on-uno.jpg` (…/L298P-Motor-Driver-Shield-Shown-On-Uno.jpg) and `back.jpg` (…/L298P-Motor-Driver-Shield-Back.jpg)
  from protosupplies.com return **HTTP 404** to a direct request (they appear on the product page, so the site
  probably blocks hotlinking). I didn't try to get around that. back-2.jpg covers the back view.

## Pin facts (from protosupplies.com product page + the diagrams above)
Motors D10–D13 · servo D9 (own 5V regulator, needs ≥ ~6.5V motor supply) · ping trig D7 / echo D8 ·
RGB R D3, G D5, B D6 · buzzer D4 (active HIGH) · Bluetooth on D0/D1 · A0–A5 sensor headers with 5V/GND.
