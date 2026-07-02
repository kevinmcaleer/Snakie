**SAM** — Software Automated Mouth. Type text, pick a pin, and the board speaks it out of a single buzzer/speaker pin.

## What it does
Type into the speech bubble and press **SPEAK** (or Ctrl/Cmd+Enter). The IDE ensures the `sam` library is on the board (mip-installing `github:kevinmcaleer/sam` — with its `sam_render.mpy` accelerator — when missing), then exec-s a `say(...)` on the chosen pin. **Open demo** drops a runnable `sam_demo.py` into the editor.

## How to use it
Connect a board and choose the **BUZZER PIN** from the board's GPIOs. Unlike the tone panels this runs via `device.exec` — no control-poll loop needed. The exec it sends is simply:

```python
from sam import SAM
SAM(pin=0).say("Hello, I am Sam")
```

- Library: github.com/kevinmcaleer/sam
