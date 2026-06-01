# Snakie — Real-Hardware Test Plan

Manual, on-device validation plan for Snakie. Tracks issue
[#45](https://github.com/kevinmcaleer/Snakie/issues/45) (real-hardware
validation).

The automated unit tests in this repo cover the pure parsing/formatting logic
(outline, variables inspector, serial-plotter line parsing). Everything below
requires a **physical MicroPython board** and must be run by hand — CI cannot
exercise USB serial, firmware flashing, or the device filesystem.

## How to use this document

1. Build/run the app you want to validate (`npm run dev` for a dev build, or a
   packaged artifact from `npm run dist`).
2. Work top-to-bottom through each section for **each board** under test.
3. Tick the checkbox and record Pass/Fail + notes in the result table at the end
   of each section. Note the app version (`package.json` `version`) and OS.

## Boards under test

Run the full plan on at least one board from each MicroPython family:

- [ ] **ESP32** (e.g. ESP32-DevKitC / ESP32-WROOM) — USB serial via CP210x or
      CH340.
- [ ] **RP2040** (Raspberry Pi Pico / Pico W) — USB CDC serial; BOOTSEL
      mass-storage bootloader for firmware.
- [ ] (Optional) **ESP8266** if firmware-flash parity matters.

Record for each board:

| Field | Value |
| --- | --- |
| Board / variant | |
| MicroPython firmware version | |
| Host OS + version | |
| Snakie version | |
| Serial port / driver | |

---

## 1. Connection & port enumeration

- [ ] Board appears in the port list (correct path, manufacturer where known).
- [ ] Connect succeeds at default baud (115200); status shows **connected** with
      the right port + baud.
- [ ] Disconnecting a live board (unplug USB) transitions UI back to
      **disconnected** without a crash.
- [ ] Reconnect after unplug works without restarting the app.
- [ ] Connecting to a busy/occupied port surfaces a clear error (not a silent
      hang).

Expected: state transitions match (`connecting` → `connected`, and
`error`/`disconnected` on failure). No stuck spinner.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Port enumeration | | |
| Connect | | |
| Unplug → disconnected | | |
| Reconnect | | |
| Busy-port error | | |

## 2. Interactive REPL (terminal)

- [ ] Typing in the terminal echoes and `>>>` prompt responds.
- [ ] `print('hello')` returns `hello`.
- [ ] Ctrl-C interrupts a running loop (e.g. `while True: pass`).
- [ ] Ctrl-D soft-reset reboots the interpreter (banner reprints).
- [ ] Multi-line paste / block input behaves.
- [ ] Unicode output renders correctly.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Echo + prompt | | |
| print | | |
| Ctrl-C interrupt | | |
| Ctrl-D soft reset | | |
| Unicode | | |

## 3. Run / Stop / Clear

- [ ] **Run** the active editor file on the device; stdout appears in the
      terminal.
- [ ] A script with a runtime error shows the traceback.
- [ ] **Stop** halts a long-running script (e.g. infinite loop with prints).
- [ ] **Clear** clears the terminal buffer without disconnecting.
- [ ] Running a second script after Stop works (raw-REPL state recovered).

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Run script | | |
| Traceback shown | | |
| Stop | | |
| Clear | | |
| Run again after Stop | | |

## 4. Local file operations

- [ ] Open a local folder; tree renders.
- [ ] Open a file into an editor tab; contents correct.
- [ ] Edit + save a local file; change persists on disk.
- [ ] Create / rename / delete a local file via the tree.
- [ ] Create / rename / delete a local folder.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Open folder | | |
| Open file | | |
| Save | | |
| File create/rename/delete | | |
| Folder create/rename/delete | | |

## 5. Device file operations

- [ ] Device file tree lists the board's filesystem (root + subdirs).
- [ ] Open a device file; contents match (incl. a file with non-ASCII bytes).
- [ ] Save edits back to the device; re-open confirms persistence.
- [ ] Create / rename / delete a device file.
- [ ] Create / delete a device directory.
- [ ] Large file (> a few KB) reads/writes intact — verify byte-for-byte
      (hex chunking path).
- [ ] Binary file round-trips without corruption.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| List device FS | | |
| Open device file | | |
| Save to device | | |
| Create/rename/delete file | | |
| Create/delete dir | | |
| Large file round-trip | | |
| Binary round-trip | | |

## 6. Upload / Download

- [ ] **Upload** a local file to the device; appears in device tree with correct
      contents.
- [ ] **Download** a device file to local disk; contents match.
- [ ] Upload overwrites an existing device file correctly.
- [ ] Upload to a subdirectory path works.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Upload | | |
| Download | | |
| Overwrite on upload | | |
| Upload to subdir | | |

## 7. Serial Plotter

Run a script that prints numeric data in each supported format and confirm the
plot.

- [ ] Single number per line (`print(value)`): one auto series plots.
- [ ] CSV / space / tab multi-column (`print(a, b, c)`): multiple series, one
      per column.
- [ ] Labelled pairs (`temp:21.4, humidity:48` or `x=1 y=2`): named series.
- [ ] Non-numeric lines are ignored (no spurious series, no crash).
- [ ] Pause freezes the chart; Resume continues.
- [ ] Clear empties the chart and legend.
- [ ] Window-size control changes the rolling window.
- [ ] Plotter does not disturb the terminal (both update from the same stream).

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Single number | | |
| Multi-column | | |
| Labelled pairs | | |
| Non-numeric ignored | | |
| Pause/Resume | | |
| Clear | | |
| Window size | | |
| Terminal unaffected | | |

## 8. Variables inspector

- [ ] With a board connected, the Variables tab lists user globals after running
      code that defines some.
- [ ] Types and reprs render correctly (int, str, list, dict, custom object).
- [ ] A value whose repr is very long is truncated (no flooding).
- [ ] **Refresh** re-reads current globals.
- [ ] Disconnecting clears the list and shows the connect hint.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Lists globals | | |
| Types/reprs correct | | |
| Long repr truncated | | |
| Refresh | | |
| Clears on disconnect | | |

## 9. `mip` package install

- [ ] Install a known package (e.g. `mip install <pkg>`); progress/output shown.
- [ ] Installed module is importable on the device afterward.
- [ ] Failure (bad package name / no network) surfaces a clear error.

> Note: `mip` requires the board to have network access (Wi-Fi boards: ESP32,
> Pico W). Note connectivity in results.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| Install package | | |
| Import installed module | | |
| Error on bad install | | |

## 10. Firmware flashing

> Destructive: erases the board. Have the correct `.bin`/`.uf2` ready and back
> up any device files first.

### ESP32 (esptool path)

- [ ] Select correct port + ESP32 firmware `.bin`.
- [ ] Erase + flash completes; progress reported.
- [ ] Board boots into the new MicroPython (REPL banner shows new version).
- [ ] Reconnect + run a script post-flash.

### RP2040 / Pico (UF2 / BOOTSEL path)

- [ ] Enter BOOTSEL (mass-storage) mode; flow detects/guides it.
- [ ] Copy/flash the `.uf2`; board reboots into MicroPython.
- [ ] Reconnect + run a script post-flash.

| Step | Pass/Fail | Notes |
| --- | --- | --- |
| ESP32 select firmware | | |
| ESP32 erase+flash | | |
| ESP32 boots new fw | | |
| RP2040 BOOTSEL | | |
| RP2040 flash UF2 | | |
| RP2040 boots new fw | | |

---

## Regression / stability sweep

- [ ] No unhandled errors in the dev console during a full pass.
- [ ] Switching tabs/panels mid-operation does not break the connection.
- [ ] App quits cleanly with a board connected (port released).
- [ ] Repeat connect/disconnect 5× — no leaked ports or zombie state.

## Sign-off

| Board | Tester | Date | Overall result |
| --- | --- | --- | --- |
| ESP32 | | | |
| RP2040 | | | |
