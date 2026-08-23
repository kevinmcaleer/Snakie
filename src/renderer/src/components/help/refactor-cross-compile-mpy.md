A module this size is parsed on the board at every boot.

```python
# A 600-line module, imported on every boot…
import robot_control     # parsed and compiled to bytecode, every single time

# …ships as robot_control.mpy instead: already compiled, smaller, faster to import.
```

## Why it matters

When MicroPython imports a `.py` it *compiles* it — tokenise,
parse, build a bytecode object — on the board, at boot, every boot. The parser
needs heap while it runs, and on a large module that transient peak is often
the largest allocation your program ever makes. It is a common and very
confusing cause of a `MemoryError` that happens during `import`, before any of
your own code has run.

`mpy-cross` does that compilation on your laptop instead and produces a `.mpy`
file. The board loads it directly: no parsing, no parser heap, a noticeably
faster boot, and less flash used. Import it exactly as before — the name is
unchanged, and `import robot_control` finds `robot_control.mpy` happily.

Two things to know before you reach for it. First, `.mpy` files are tied to a
**bytecode version**: one built for MicroPython 1.24 will not load on 1.19, so
the file has to be rebuilt when you update firmware. Second, you lose the
ability to read and edit the code on the board, which is exactly the thing
that makes MicroPython pleasant to learn with — so this belongs on stable
library modules, not on the file you are actively working in.

Snakie only points. Actually running `mpy-cross` is a build-pipeline feature
rather than a refactoring, and it deserves to be one in its own right.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
