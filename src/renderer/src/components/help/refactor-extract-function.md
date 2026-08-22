Move the selected statements into a function of their own.

```python
# before — select the four lines that work out the average
def report(readings, radio):
    radio.send(b"start")
    total = 0
    for reading in readings:
        total += reading
    average = total / len(readings)
    radio.send(b"%d" % average)

# after
def compute_average(readings):
    total = 0
    for reading in readings:
        total += reading
    average = total / len(readings)
    return average

def report(readings, radio):
    radio.send(b"start")
    average = compute_average(readings)
    radio.send(b"%d" % average)
```

## Why it matters

This is the refactoring the rest of the catalogue keeps
pointing at. "Too deeply nested" (rule 5), "this function is too long"
(rule 11) and "these branches are nearly the same" all end with *give that
block a name*, and a name is the cheapest documentation there is — it turns
four lines a reader has to simulate in their head into one line they can
read. On a microcontroller it also gives you something you can test on the
desktop without the robot plugged in.

**This is the only selection-driven rule in the catalogue.** There is no
smell to scan for: which lines belong together is a judgement about meaning,
not about syntax, so the rule offers nothing until the user has selected
whole statements (). Snakie returns `[]` with no selection, which is
also why its golden fixture rewrites nothing.

### Why the rewrite is safe

The new `def` is inserted as the **immediate sibling** of the enclosing
function, so its enclosing scope chain is exactly the enclosing function's
chain minus the function itself. Every name the block reads therefore
resolves the same way it did before, provided the ones that were *local to
the enclosing function* are handed over explicitly — which is precisely the
parameter list (`bindingScopeFor` picks them out, and leaves module globals,
imports and builtins alone, because those are still visible from inside a
function defined next door). Being a sibling of the `def` also means the
helper is bound at the same moment the enclosing function is, so it can never
be missing when the call runs.

Values flow back out through the return tuple: every name the block binds
that anything outside it still reads. "Reads it afterwards" is not only about
source order — a read *above* the selection runs again on the next turn of an
enclosing loop, and a read inside a nested `def`, `lambda` or generator
expression runs whenever that is called — so both count. Over-returning a
value is harmless (the caller assigns it straight back); under-returning one
silently loses a write, so the analysis leans the safe way.

### What it declines rather than guess ()

- a `return`, `yield`, or a `break`/`continue` whose loop is outside the
  selection: the jump would land somewhere else entirely;
- `global`/`nonlocal` in the block — it binds names in a scope the new
  function does not have;
- an `await`, `async for` or `async with` inside a function that is not
  `async` (in an `async def` the helper is generated `async` and the call is
  awaited);
- a **method** — a class body is not a scope its methods can see, so a
  sibling `def` would be invisible to a bare call. Extracting a *method* is a
  different rewrite (it has to emit `self.…` at the call site and check the
  whole class for member collisions), and doing it wrong here would produce a
  `NameError` at runtime rather than a bad-but-working shape;
- a selection that straddles a block boundary or takes only part of a
  compound statement — the run must be whole, contiguous, sibling statements;
- a returned value where the block sits inside a `try`: a half-finished block
  leaves the earlier assignments visible to the handler, and a call that
  raised leaves none of them;
- a multi-line string in the block, or a line indented shallower than the
  block itself, because re-indenting would rewrite the string's own contents.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
