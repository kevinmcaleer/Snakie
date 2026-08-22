A boolean parameter that switches behaviour hides what the call site does.

```python
def draw_status(display, battery, verbose=True):
    if verbose:
        display.text("battery {}%".format(battery), 0, 0)
        display.text("mode: manual", 0, 10)
    else:
        display.text("{}%".format(battery), 0, 0)
```

A boolean parameter that picks between two behaviours means the function is
really two functions wearing one name, and the call site pays for it:
`draw_status(oled, level, False)` tells the reader nothing at all. Splitting
it — `draw_status(oled, level)` and `draw_status_compact(oled, level)` — puts
the choice in the name, deletes the branch, and makes each half easy to test
on its own. (Where a split really is wrong, a keyword-only argument at least
forces the call site to say `verbose=False` out loud.)

This one is **hint only**: which half keeps the original name, what the other
is called, and how the shared setup is divided are all judgement calls about
*this* program, and every caller has to move with it. Snakie makes no change —
the panel shows the explanation and the "Why?" article, never a diff.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
