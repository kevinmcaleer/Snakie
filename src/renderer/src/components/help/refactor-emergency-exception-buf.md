This file registers an interrupt but reserves no emergency exception buffer.

```python
from machine import Pin              from machine import Pin
                                     import micropython

                                     micropython.alloc_emergency_exception_buf(100)

button.irq(handler=on_press)         button.irq(handler=on_press)
```

When an exception escapes an interrupt handler, MicroPython needs memory to
build the traceback — and the heap is exactly what it may not touch in
interrupt context. Without a pre-allocated buffer it therefore prints
*nothing at all*. Your handler dies, the robot quietly stops responding to the
bumper, and the REPL shows a blank line. People lose whole evenings to this.

`micropython.alloc_emergency_exception_buf(100)` reserves 100 bytes once, at
import time, and the traceback appears. It costs a hundred bytes and a line,
it is in every serious MicroPython codebase, and it is missing from almost
every beginner one — which is what makes it one of the highest-value rules in
the catalogue.

One match per file: the fix is one line, wherever the interrupts are.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
