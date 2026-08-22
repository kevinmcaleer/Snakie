This emitter cannot speed this function up, and it still costs flash and import RAM.

```python
# before                                # after
@micropython.native                     def average(samples):
def average(samples):                       total = 0
    total = 0                               for value in samples:
    for value in samples:                       total += value
        total += value                      return total / len(samples)
    return total / len(samples)
```

## Why it matters

The emitters are not free, and they are not magic. Compiling a
function to machine code produces something considerably bigger than the
bytecode it replaces — it costs flash to store and it costs RAM the moment the
module is imported. You pay that price whether or not the function gets any
faster.

And there are shapes the emitters simply cannot help with:

- **Floats.** Both emitters shine on integers. A function whose real work is
  `/` or `3.14` spends its time in floating-point runtime calls that the
  decorator does not touch. Under viper a float will not compile at all.
- **`*args` / `**kwargs` / keyword-only parameters.** Assembling that argument
  tuple or dict is Python object work at every single call.
- **`yield`.** A generator has to keep its frame alive across suspensions, so
  it stays on the bytecode interpreter no matter what you decorate it with.
- **Closures.** Reading a variable from the enclosing function goes through a
  cell object, which is a pointer chase the emitter cannot optimise away.
- **`try` / `except`.** Setting up an exception handler is bookkeeping in the
  runtime, not arithmetic; and under viper the handler is not supported.

This one is a `warning` rather than a hint because the code is *paying* for
something. A hint you ignore costs nothing; a decorator you keep costs flash
and import RAM on a board that has very little of either, forever, in exchange
for no speed at all. Deleting the line is the entire fix.

The rewrite removes the emitter decorator's own line and nothing else — an
`@staticmethod` or `@property` above or below it stays exactly where it was.
The `import micropython` line is left alone even when it becomes unused: ruff
owns unused imports (rule 33), and two tools quietly editing the same line is
how a fix turns into a merge conflict.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
