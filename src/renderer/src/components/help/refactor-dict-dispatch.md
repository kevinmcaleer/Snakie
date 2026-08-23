This chain compares one value against literals — that is a dict, written out longhand.

```python
# before                          # after
def duty_for(mode):               _MODE_TABLE = {
    if mode == "crawl":               "crawl": 12000,
        return 12000                  "cruise": 32000,
    elif mode == "cruise":            "sprint": 58000,
        return 32000              }
    elif mode == "sprint":
        return 58000              def duty_for(mode):
    else:                             return _MODE_TABLE.get(mode, 0)
        return 0
```

## Why it matters

A chain that compares *one* expression against a run of
literals is not really control flow at all — it is a table someone wrote out
as code. Reading it, you have to check every branch to be sure they all test
the same thing; adding a mode means adding two more lines in the middle of a
function; and on the way past, MicroPython evaluates the comparison once per
branch until one hits. A dict says the same thing as data: the mapping is
visible at a glance, a new entry is one line, and the lookup is a single hash
whatever the table's size.

**This one is `a judgement call`, and the reason is the whole rule.** A dict literal
evaluates *every* value the moment it is built; the chain evaluated exactly
one. Turn `elif mode == "sprint": return spin_up()` into a table and the motor
spins up at import time, for every mode. So each mapped value — and the
default — has to be provably pure before we will offer anything, and even then
a human should look at the cost of building the table once at import.

The other things we decline rather than guess at:

- **fewer than three branches** — two cases are an `if`/`else`, and a table
  costs more than it saves;
- **an assignment chain with no `else`** — the chain leaves the target at
  whatever it already held; `TABLE.get(key)` would overwrite it with `None`;
- **a `return` chain with no `else` that is not the last statement of its
  function** — falling off the end of the chain runs the code below it, where
  `return TABLE.get(key)` would skip it. When the chain *is* last, falling off
  the end returned `None` anyway, so the rewrite is exact — the message still
  says so out loud, because a missing key is now `None` rather than a
  fall-through, and that is worth seeing;
- **keys that are not distinct literals** — `1` and `1.0` are one dict key
  even though they are two different branches;
- **anything with a comment in it** — the chain's lines are replaced wholesale,
  and a rewrite must never eat someone's note.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
