This expression is written more than once here — name it and use the name.

```python
def blend(base, trim):              def blend(base, trim):
    if base + trim * 2 > LIMIT:         value = base + trim * 2
        report("clipped")               if value > LIMIT:
    return base + trim * 2                  report("clipped")
                                        return value
```

The same sum written twice is the same *idea* written twice, and the reader has
to compare them character by character to be sure they really are the same. A
name says it once, and the second reading is free. It is also the first half of
every larger refactoring: you cannot extract a function out of an expression
you have not named yet.

**What Snakie will not touch**, because it cannot prove the rewrite is
behaviour-preserving:

- Anything with a **call or a subscript** in it. `sensor.read()` twice is two
  reads of live hardware, and naming it collapses them into one — that is a
  real change, and only the author knows whether it is the change they want.
- Anything with an **attribute** in it. `self.motor.speed` looks like a plain
  read, but it may run a property, and any call sitting between the two
  occurrences may rewrite it. Neither is provable from one file, so expressions
  here are built from plain names, literals and operators only.
- Occurrences that are **evaluated conditionally** — the right-hand side of an
  `and`/`or`, either arm of `a if c else b`. `if divisor and total / divisor:`
  guards the division on purpose; hoisting it above the guard turns a working
  program into a `ZeroDivisionError`.
- Occurrences in **different blocks**. The new assignment goes immediately
  before the first statement that uses it, in that statement's own block, so a
  copy inside a loop and a copy outside it are simply left alone rather than
  hoisted past the loop boundary.
- Anything whose ingredients are **rewritten in between** — if `speed` is
  reassigned between the two copies then they were never the same value, and
  naming them would quietly pick one.
