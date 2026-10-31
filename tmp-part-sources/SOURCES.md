# Open Duck Mini part image sources

Source images for the Open Duck Mini v2 parts. The parts list comes from the
upstream v2 BOM spreadsheet (linked from github.com/apirrone/Open_Duck_Mini
README):
https://docs.google.com/spreadsheets/d/1gq4iWWHEJVgAA_eemkTEsshXqrYlFxXAPwO515KpCJc

Each `examples/parts/snakie-standard/<id>/image.png` is cropped from the image
listed here. The background is removed and the result is downscaled to 512 px
or less. Files in `tmp-part-sources/<id>/` are references for pin and terminal
labels, downscaled to 1200 px or less. They are not shipped.

Cutout method: `rmbg` = the skill's Vision cutout (rmbg.swift).
`flood` = an edge flood-fill of the plain backdrop, used where Vision ate
parts of the board. `alpha` = the source image already had transparency.

| id | BOM item (upstream) | vendor / source | image.png from | cutout | reference files |
|----|---------------------|-----------------|----------------|--------|-----------------|
| raspberry-pi-zero-2w | Raspberry Pi Zero 2 W ×1 | Raspberry Pi Ltd, https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/ | https://assets.raspberrypi.com/static/f03a00485ac096c1033ad1c4a530d63b/74ad4/zero2-close-up.png | alpha | pinout.png ← https://www.raspberrypi.com/documentation/computers/images/GPIO-Pinout-Diagram-2.png ; board-top.png ← image source |
| bno055 | IMU (BNO055) ×1, Amazon B017PEIGIG = Adafruit #2472 | Adafruit, https://www.adafruit.com/product/2472 | https://cdn-shop.adafruit.com/970x728/2472-12.jpg | rmbg | pinout.png ← 2472-12.jpg (front silk: Vin 3vo GND SDA SCL RST / PS0 PS1 INT ADR) ; back.png ← https://cdn-shop.adafruit.com/970x728/2472-11.jpg |
| sts3215 | Feetech STS3215 7.4 V (19 kg·cm) ×14 | Waveshare ST3215 (rebadged Feetech STS3215), https://www.waveshare.com/st3215-servo.htm | https://www.waveshare.com/media/catalog/product/cache/1/image/800x800/9df78eab33525d08d6e5fb8d27136e95/s/t/st3215-servo-4.jpg | rmbg | connector-side.png ← …/st3215-servo-5.jpg ; horn-top.png ← …/st3215-servo-4.jpg |
| waveshare-bus-servo-adapter | Servo control board ×1 = Waveshare Bus Servo Adapter (A) | Waveshare, https://www.waveshare.com/bus-servo-adapter-a.htm | https://www.waveshare.com/media/catalog/product/cache/1/image/800x800/9df78eab33525d08d6e5fb8d27136e95/b/u/bus-servo-adapter-a-3_2.jpg | flood | pinout.png ← same image (D V G servo ports, TX RX GND UART, A/B jumper, DC+/DC−, USB-C, DC 9–12.6 V jack) |
| battery-18650 | 18650 cell ×2 = Molicel INR18650-P30B 3000 mAh 30 A | NKON, https://www.nkon.nl/fr/molicel-inr18650-p30b-3000mah-30a.html | https://www.nkon.nl/media/catalog/product/i/m/image_template_nkon3336_0050_layer_22_1.jpg | rmbg | cell.png |
| battery-holder-18650-2s | 18650 cell holder ×1 (CABLEPELADO 2×18650, Amazon.fr B08YDTSML8) | The BOM listing has only a single-cell product photo, so a generic 2×18650 holder from Amazon.fr B0H419RXBW is used | https://m.media-amazon.com/images/I/61jAkQAhqxL._SL1478_.jpg (left holder) | rmbg | dimensions.png ← https://m.media-amazon.com/images/I/61EbFsnfUoL._SL1418_.jpg ; top.png ← image source |
| bms-2s | 2S BMS ×1 = JZK 2S 7.4 V/8.4 V BMS, 41×16×3.5 mm, 8 A (Amazon.fr B09VGH38Y5, via shorturl.at/OEXM1) | Amazon.fr listing | https://m.media-amazon.com/images/I/61aTzfOzp1L._AC_SL1500_.jpg | rmbg | pinout.png ← https://m.media-amazon.com/images/I/61rC4v0TtGL._AC_SL1500_.jpg (B+ B− BM P+ P−, 41×16 mm) ; top.png ; back.png ← https://m.media-amazon.com/images/I/5191r7c+nrL._AC_SL1500_.jpg |
| buck-5v | 5V regulator ×1 = HENGE 4A–12A UBEC (Alibaba 1601260325461). That listing is now "Product Not Available", so the brief's fallback, a Mini560 5 V module, is used | Amazon.fr B0HGFGK1GN (MINI560 5 V 5 A) | https://m.media-amazon.com/images/I/71x+Qaa3RrL._SL1500_.jpg (centre board) | flood | pinout.png ← https://m.media-amazon.com/images/I/71d9RRyCxgL._SL1500_.jpg (Input+/−, Output+/−, EN) ; schematic.png ← https://m.media-amazon.com/images/I/71H0-41bYkL._SL1500_.jpg (from the B0GYHRNS4S listing) ; dimensions.png ← https://m.media-amazon.com/images/I/71K-ttM7eWL._SL1500_.jpg |
| power-switch | Small power switch ×1 = 6-pin DPDT (2P2T) slide switch, 15.6×7.6×7 mm (Amazon.fr B0CH3JCQM5) | Amazon.fr listing | https://m.media-amazon.com/images/I/61qJDjJ1aDL._SL1500_.jpg (top part, text cropped off) | rmbg | dimensions.png ← https://m.media-amazon.com/images/I/61qoY0M9NML._SL1500_.jpg |
| usb-c-charger-2s | usb-c charger ×1 = Adeept USB-C 2S 2 A 8.4 V charging module (MRB045 boost) (Amazon.fr B0BWTK7SVN) | Amazon.fr listing | https://m.media-amazon.com/images/I/61sDqULNnFL._AC_SL1000_.jpg (top half = component side) | rmbg | pinout.png ← same image (VIN GND / BAT GND, OK CR LEDs, bottom: MRB045 2S/2A) ; dimensions.png ← https://m.media-amazon.com/images/I/51dIcTKgccL._AC_SL1000_.jpg (37×17 mm) |
| ss-10-microswitch | Feet contact switches (SS-10) ×4 | AliExpress 1005006164610609 (BOM link) | https://ae-pic-a1.aliexpress-media.com/kf/Sd81a21dccdbb4d8bba91bcd675fdaf90q.jpg (SS-10 tile only) | rmbg | variants.png ← same image. LOW-RES (162×123) WITH A FAINT STORE WATERMARK. Replace with a better photo. |
