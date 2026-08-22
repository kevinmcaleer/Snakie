# Sprite editor & the `.spr` format

The Sprite editor (Display instrument → **✎ Sprites**) draws 1-bit sprites and
frame animations for LED matrices and OLED displays, with a filmstrip of frames,
onion skinning, live playback and undo/redo. This document records the file
formats it reads and writes, and why they were chosen.

## Survey: how others store sprites for microcontrollers

| Prior art | Format | Trade-off |
| --- | --- | --- |
| Pimoroni PicoGraphics (v1) | Raw headerless `.rgb332` spritesheets (fixed 128×128 sheet of 8×8 sprites) | Zero parsing, but the geometry is hardcoded in code and there is no animation timing at all. |
| Thumby | Raw headerless `.bin`, MONO_VLSB, frames simply concatenated (`frameCount = filesize // frameSize`) | Streams frames from flash through one buffer — very low RAM — but dimensions and frame rate live in code, not the file. |
| Badger 2040 images | Raw headerless 296×128 1-bit dumps | Same: implicit geometry. |
| PicoGraphics 2 / Badgeware | Standard PNG / JPEG / **GIF** (`spritesheet.timings` carries GIF per-frame delays) | Self-describing and tool-friendly, but needs C-level decoders — no good on a plain `framebuf` target. |
| micro:bit `Image` | ASCII digit strings (`"90009:09090:…"`) | Lovely for 5×5 teaching icons, hopeless beyond that. |
| Adafruit CircuitPython | Indexed BMP via `adafruit_imageload` + `TileGrid` sheets | Needs displayio; timing lives in code. |

The gap: nothing is both **self-describing** and **trivially parseable** on a
stock MicroPython board. `.spr` fills it.

## Single frames: PBM

Binary PBM (**P4**) is the single-frame interchange format because its raster is
**byte-for-byte identical to `framebuf.MONO_HLSB`**: row-major, most-significant
bit = leftmost pixel, each row padded up to a whole byte. A P4 file loads
on-device with one `readinto()` + a `FrameBuffer` wrap and zero per-pixel work,
and every desktop image tool can open it. Polarity follows the PBM spec (1 =
ink); the editor treats ink as "lit", which is what existing MicroPython PBM
loaders do when they feed the raster straight into a mono framebuffer. ASCII
**P1** is also read.

## Animations: the `.spr` container (magic `SNKS`, version 1)

A fixed 16-byte little-endian header, an optional per-frame duration table, then
the frames concatenated (Thumby-style, so playback streams from flash through a
single reusable buffer — RAM cost is one frame regardless of length):

```
offset size  field
0      4     magic       "SNKS"
4      1     version     1
5      1     flags       bit0: u16 per-frame duration table follows the header
                         bit2: loop
6      1     format      0 = 1-bit MONO_HLSB (mirrors framebuf's constants so
                         2/4/8/16-bit formats can arrive without a version break)
7      1     reserved    0
8      2     width       u16 LE
10     2     height      u16 LE
12     2     frame_count u16 LE
14     2     duration_ms u16 LE (per frame; the default when bit0 is set)
16     …     [durations] u16 LE × frame_count      (only if flags bit0)
       …     frames      frame_count × stride·height bytes,
                         stride = ceil(width / 8)  (PBM-style padded rows)
```

A complete MicroPython player is ~20 lines — see
`examples/sprites/play_spr.py`, which blits onto an SSD1306; the same frames
drive non-framebuf targets (e.g. the Arduino Modulino LED Matrix) pixel-by-pixel
(`examples/sprites/modulino_eyes.py`).

## Desktop interchange: PNG · JPEG · GIF · `.py`

- **Export**: PNG (single frame or a horizontal sprite sheet), JPEG, and a
  looping animated GIF, each at an integer pixel scale (1× round-trips; bigger
  scales for sharing). Also a ready-to-import **MicroPython module** with the
  frames as `bytes` literals plus `frame()` / `pixel()` / `play()` helpers.
- **Import**: `.spr`, PBM, PNG, JPEG and animated GIF (per-frame GIF timings are
  kept). Images are thresholded to 1-bit; bright-on-black art is repolarised
  automatically, and integer-upscaled pixel art (a 12×8 sprite shared at ×10) is
  detected and folded back to its true grid.

## Sprites in the code: what counts as a reference

A `.spr` named in an open Python file draws itself inline, at about line height,
**always visible** — clicking it opens that sprite for editing (#790). Two more
features hang off the same question (autocompleting sprite names, #791; the
"used in" back-link, #792), so the rule is settled once, in one pure module,
`sprite-refs.ts`:

> A sprite reference is a **single-quoted Python string literal whose text names
> a `.spr` file**, resolved against the file's own folder first and then the
> project root. Anything else does **nothing**.

| Written as | Recognised? | Why |
| --- | --- | --- |
| `Spr("eyes.spr")` | ✅ | a literal naming one file |
| `SPR_FILE = "sprites/eyes.spr"` | ✅ | the rule keys off the LITERAL, not off any loader name — which is what `examples/sprites/play_spr.py` actually writes |
| `r"art\eyes.spr"`, `b"eyes.spr"` | ✅ | string prefixes are understood |
| `"/home/kev/eyes.spr"` | ✅ | absolute — taken at its word |
| `f"{stem}.spr"`, `"%s.spr" % s` | ❌ | a template: the real name is unknowable |
| `name + ".spr"` | ❌ | the name is in a variable |
| `"frames/*.spr"` | ❌ | a glob names many files, or none |
| `# eyes.spr`, `"""…eyes.spr…"""` | ❌ | a comment or a docstring mentions a sprite; it does not use one |

The refusals are deliberate: **a thumbnail beside the wrong sprite is worse than
no thumbnail**. What is *shown* follows the same principle — a multi-frame
animation shows its first inked frame and holds still (a cycling image in a code
editor competes with the text), a reference that resolves to a file that is not
there is drawn as a broken marker rather than vanishing, and a reference with
nowhere to resolve against at all (an unsaved buffer, no project folder open)
draws nothing, because "I cannot tell" is not the same as "it is broken".

Reading and rendering happens once per file per mtime (`sprite-thumb-cache.ts`);
the paint pass itself is synchronous and does no I/O, so typing costs nothing.

## Where the code lives

Pure, node-tested logic: `sprite-model.ts` (document + edits),
`sprite-codecs.ts` (PBM / `.spr` / draft JSON), `sprite-export.ts` (the `.py`
module), the pure half of `sprite-image-io.ts` (threshold / polarity / descale),
`sprite-refs.ts` (the reference rule above) and `sprite-thumb.ts` (a frame → an
SVG data URI); `sprite-seed.ts` is the bundled blinking-eyes starter. The DOM
half of `sprite-image-io.ts` does canvas/`gifenc`/WebCodecs encoding-decoding,
`sprite-thumb-cache.ts` is the path+mtime cache behind the inline thumbnails and
`sprite-decorations.ts` their Monaco glue (wired up in `MonacoEditor.tsx`), and
`SpriteEditor.tsx` is the overlay UI (launched via `sprite-editor-bus.ts` from
`DisplayInstrument.tsx` or from an inline thumbnail, hosted in `AppShell.tsx`).
