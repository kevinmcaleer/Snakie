This function is integer work end to end — viper can hold it all in registers.

```python
# before                          # after
def crc8(seed, byte):             @micropython.viper
    crc = seed ^ byte             def crc8(seed: int, byte: int) -> int:
    for _ in range(8):                crc = seed ^ byte
        crc = (crc << 1) & 0xFF       for _ in range(8):
    return crc                            crc = (crc << 1) & 0xFF
                                      return crc
```

## Why it matters

`@micropython.native` (rule 43) compiles your function to
machine code but keeps every Python semantic, which is typically worth about
2×. The **viper** emitter goes much further. Annotate a value `int` and it
stops being a Python object altogether: it lives in a CPU register as a raw
machine word, arithmetic on it is one instruction, and nothing is allocated
for it on the heap. On integer-heavy code — a CRC, a fixed-point filter, a
bit-banged protocol — that is commonly several times faster than bytecode, and
it is the fastest thing you can reach without writing assembly.

The price is that the inside of the function is no longer really Python. The
`int` annotations are **not** type hints in the CPython sense; they change the
calling convention. `def crc8(seed: int)` converts whatever the caller passes
into a machine word, so handing it a bytearray is a `TypeError` at the call
site rather than a warning in your editor. Integers stop being arbitrary
precision and start wrapping silently at the machine word (rule 48). Floats,
strings, dictionaries and method calls either refuse to compile or fall back
to slow object code, which loses you the whole point of the exercise.

So Snakie is deliberately fussy about what it will offer on. It fires only
where it can see the function is integer work end to end: every parameter used
only in arithmetic, comparisons or `range()`, no attribute access, no method
calls, no strings, no floats, no globals, no `try`/`except`, and a `return`
with a value on the way out. Anything less and it says nothing, because a
decorator that will not compile — or worse, one that compiles and quietly
narrows what your callers are allowed to pass — is far more expensive than a
hint you never saw.

Then measure. The **Benchmark on device** button beside the diff times the
function on the board that is plugged in, before and after, so you keep the
change when it is worth 5× and drop it when it is worth 5%.

Gated on the firmware actually having the viper emitter compiled in — it is a
`SyntaxError` where it is missing — so Snakie asks the board rather than
guessing, and offers nothing at all when no board is connected.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
