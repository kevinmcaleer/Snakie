# Arduino UNO raw assets — sources

Downloaded 2026-11-06. All files are official Arduino material.

**Licence:** the CAD archives each contain a `License.txt` (copied as `LICENSE.txt` in each folder):
"This project's hardware is licensed under the Creative Commons Attribution-ShareAlike 4.0
International License" — https://creativecommons.org/licenses/by-sa/4.0/ . The pinout PDFs carry the
same CC BY-SA 4.0 notice in their footer. Store product photos (`top.jpg`) have no licence stated;
they are Arduino's product photography — treat as © Arduino, use as reference only.

`top-cutout.png` = `top.jpg` run through `rmbg` (macOS Vision foreground mask). `pinout.png` = page 1
of `pinout.pdf` rendered with `pdftoppm -r 200`.

No `top-from-pinout.png` crops: the board drawings inside the pinout PDFs have pin leader lines drawn
over them, so the store photos are cleaner.

## arduino-uno-r3 (A000066)
- pinout.pdf — https://docs.arduino.cc/resources/pinouts/A000066-full-pinout.pdf
- datasheet.pdf — https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf
- **No official STEP model.** The docs page's CAD archive only has Eagle files:
  https://docs.arduino.cc/static/6bb7a3ca51ebee82a252f60c0b418787/A000066-cad-files.zip
  → kept `UNO-TH_Rev3e.brd` (Eagle board: exact outline + hole positions) and `LICENSE.txt`.
- top.jpg — https://cdn.shopify.com/s/files/1/0438/4735/2471/files/A000066_03.front.jpg (1000×750)

## arduino-uno-r4-minima (ABX00080)
- pinout.pdf — https://docs.arduino.cc/resources/pinouts/ABX00080-full-pinout.pdf
- datasheet.pdf — https://docs.arduino.cc/resources/datasheets/ABX00080-datasheet.pdf
- model.step — `Additional files/PCB(ABX00080).step` from
  https://docs.arduino.cc/static/ae97aad5c05de6a565c7f93a28c04717/ABX00080-cad-files.zip
- top.jpg — https://cdn.shopify.com/s/files/1/0438/4735/2471/files/ABX00080_00.default.jpg (1000×750)

## arduino-uno-r4-wifi (ABX00087)
- pinout.pdf — https://docs.arduino.cc/resources/pinouts/ABX00087-full-pinout.pdf
- datasheet.pdf — https://docs.arduino.cc/resources/datasheets/ABX00087-datasheet.pdf
- model.step — `UNO_R4_WIFI.step` from https://docs.arduino.cc/resources/models/ABX00087-step.zip
  (licence from https://docs.arduino.cc/static/41d76ccb600d3cb1ec1e98a28d24f111/ABX00087-cad-files.zip)
- top.jpg — https://cdn.shopify.com/s/files/1/0438/4735/2471/files/ABX00087_00.front.jpg (1000×750)

## arduino-uno-q (ABX00162 2 GB / ABX00173 4 GB — same board, same docs)
- pinout.pdf — https://docs.arduino.cc/resources/pinouts/ABX00162-full-pinout.pdf (covers ABX00162-ABX00173)
- datasheet.pdf — https://docs.arduino.cc/resources/datasheets/ABX00162-datasheet.pdf
  (ABX00173-datasheet.pdf is byte-identical in size, 7,577,445 bytes)
- model.step — `UNO Q simplified.stp` from https://docs.arduino.cc/resources/models/ABX00162-step.zip
  (a *simplified* model — Arduino's only published STEP for this board)
  (licence from https://docs.arduino.cc/static/e05d1a3141208468509d10c329387dcd/ABX00162-cad-files.zip)
- top.jpg — https://cdn.shopify.com/s/files/1/0438/4735/2471/files/ABX00162_00.default.jpg (1000×750)

## Skipped for size (>40 MB)
None — largest file is the R4 WiFi STEP at ~7.2 MB.
