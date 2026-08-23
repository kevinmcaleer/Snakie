This default is built once and shared by every call — default to `None` instead.

```python
def log(reading, samples=[]):   def log(reading, samples=None):
    samples.append(reading)         if samples is None:
    return samples                      samples = []
                                    samples.append(reading)
                                    return samples
```

Python evaluates a default expression **once**, when the `def` statement runs —
not on every call. That `[]` is therefore a single list shared by every caller
who leaves the argument out, so yesterday's readings are still in it today.
It is the classic Python trap, it shows up as "why is my log growing on its
own?", and on a board that runs for weeks it eventually eats the heap.

The fix is the idiom every Python codebase uses: default to `None` and build a
fresh container inside the function, where the expression runs per call.

Only the *empty* forms (`[]`, `{}`, `list()`, `dict()`, `set()`) are offered.
A non-empty default like `[0] * 8` may well be a deliberate shared table, and
turning it into a per-call allocation would change how much RAM the function
costs — not something to do behind the author's back.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
