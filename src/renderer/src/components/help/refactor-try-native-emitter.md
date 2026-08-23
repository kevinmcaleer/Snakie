This looks like a hot loop — the native emitter may roughly double it.

```python
# before                         # after
def mix(buf):                    @micropython.native
    total = 0                    def mix(buf):
    for i in range(len(buf)):        total = 0
        total += buf[i]              for i in range(len(buf)):
    return total                         total += buf[i]
                                     return total
```

## Why it matters

By default MicroPython compiles your function to bytecode and
walks it with an interpreter loop. `@micropython.native` compiles the same
function to actual machine code for your chip instead, keeping full Python
semantics — every object, every type, every exception behaves identically.
On integer-heavy loop code that is typically around a 2× win for a one-line
change, which is the best effort-to-payoff ratio in the whole emitter story.

It is not free. The compiled code is bigger than the bytecode it replaces, so
it costs flash and it costs RAM when the module is imported. Decorating an
entire file is the classic beginner mistake: you get a fatter, slower-to-import
build and no measurable speed-up, because most functions are not the
bottleneck. So this only fires on functions that actually *look* hot — a tight
loop over integers, called from another loop, with no I/O inside — and the
advice always leads with **measure it**.

Which is the point of the **Benchmark on device** button next to the diff.
Snakie is holding a REPL connection to your board while you edit, so it can
time the function before and after and show you the real number. When the
honest answer is "4% faster", you see 4% and skip it. That is the cure for
cargo-culting these decorators, and no other MicroPython tool can offer it.

Gated on the firmware actually having the native emitter compiled in: it is a
`SyntaxError` where it is missing, so Snakie asks the board rather than
guessing, and offers nothing at all when no board is connected.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
