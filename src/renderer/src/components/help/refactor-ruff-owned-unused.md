Unused imports and variables are reported by ruff (F401 / F841), which also fixes them.

detects nothing.*

```python
import time          # ruff: F401 unused import — with a fix, already offered
from machine import Pin

def read(adc):
    raw = adc.read_u16()   # ruff: F841 local variable assigned but never used
    return adc.read_uv()
```

This catalogue slot is **owned by ruff**. Snakie already runs ruff over the
buffer, and ruff reports exactly this smell as `F401` (unused import) and
`F841` (local assigned but never read) — with an automatic fix attached, in a
checker that sees the whole file's imports far more thoroughly than a
single-purpose rule here ever would. of the epic is explicit about what happens when ruff and a Snakie rule find
the same thing: **defer to ruff and do not double-report it.** Two blue
squiggles under one `import time` is not twice the help; it is a Problems
panel that looks broken, and a beginner cannot tell whether they have one
problem or two. `refactor-hints.ts` implements the other half of that policy
through `alreadyReported` — it drops any Snakie hint whose rule id ruff has
already covered — and this file is the reason it never has to for rule 32.

So why does the file exist at all? Because the alternative is a hole in the
numbering, and a hole is something a future contributor has to *remember* is
intentional. A rule object that detects nothing, carries the catalogue number,
and explains itself keeps the delegation in the code rather than in a footnote
— and it means "every catalogue entry has a rule and a fixture" stays true.
The fixture pair is a file with an obviously unused import that Snakie
leaves untouched: the golden suite therefore asserts our *silence*.

If ruff ever stops being available (an offline install, Snakie for Web without
the host), the right answer is still not to switch this on quietly — a hint
that appears and disappears depending on what is installed is worse than one
that is consistently ruff's job.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
