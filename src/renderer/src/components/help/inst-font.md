**Font editor** — design a bitmap font glyph by glyph and export it as a MicroPython module for your OLED or TFT.

## What it does
Small displays ship with one tiny built-in font. This panel lets you draw your own — the way hand-made display fonts like picotamachibi's "Jonny 5" are made — and hands you a `.py` module you can `import` on the board.

It opens on a bundled **5×8 printable-ASCII starter font**, so you can tweak letters you don't like rather than draw ninety-five glyphs from scratch. Your work is parked in the app as you go, so closing the panel doesn't lose it. **Starter font** puts the original back.

## How to use it

- **Cell size** — `W` and `H` set the cell every glyph lives in; `BASE` is the baseline, counted in rows down from the top (the hairline under a row in the grid marks it). Everything that still fits survives a resize.
- **Charset** — printable ASCII by default; the smaller sets exist because a clock or a score readout only needs digits, and a 95-glyph font wastes flash. Narrowing the set drops the glyphs outside it, so you're asked first.
- **Draw** — click or drag on the grid. The arrows nudge the whole glyph around its cell; **Invert** swaps ink and paper; **Clear** erases it; **COPY FROM** pulls another glyph in as a starting point (handy for `O`/`0`, or `E`/`F`).
- **MONO / proportional** — a monospaced font makes every glyph the cell width. Untick **MONO** and **Auto-fit** shrinks each glyph to its own ink plus a pixel of spacing, growing the cell first so the widest letters still get their gap. **WIDTH** sets one glyph's advance by hand; **Fit** does just that glyph.
- **Preview** — the strip under the grid draws your text at **1×**, actual size, on dark glass. Type into it to try a real string; the readout on the right is how many pixels wide the line will be.

## Exporting

Pick a format and press the filename button — the module opens in the editor as a new file, ready to save to the board.

- **font-to-py module** — the layout Peter Hinch's `micropython-font-to-py` produces, so existing `Writer` code works unchanged:

```python
from writer import Writer
import myfont
Writer(ssd, myfont).printstring('hello')
```

  It emits `height()`, `baseline()`, `max_width()`, `hmap()`, `reverse()`, `monospaced()`, `min_ch()`, `max_ch()` and `get_ch()` over an indexed `_font` bytes blob, horizontally mapped (`framebuf.MONO_HLSB`).

- **Packed bytearray** — a simpler fixed-stride `bytearray` plus metrics and a five-line `glyph()` helper, for blitting into a `framebuf` yourself without `Writer`. Easier to read and hand-edit.

## Not yet
Importing an existing font module to edit, uploading straight to the board, and previewing on real hardware are follow-ups on this panel's issue (#250).
