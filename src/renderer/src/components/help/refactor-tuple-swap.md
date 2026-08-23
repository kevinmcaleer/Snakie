These three lines swap two values — Python does that in one.

```python
tmp = left_speed              left_speed, right_speed = right_speed, left_speed
left_speed = right_speed
right_speed = tmp
```

Python builds the right-hand tuple *before* it binds anything, so the middle
variable the three-line version needs simply is not needed. Three statements
that only make sense read together become one that says "swap these", and the
scratch name — the one you have to check is not used anywhere else, and that
goes stale when someone edits two of the three lines — disappears.

The rule only fires when it can prove the temporary really is a temporary:
written exactly once, read exactly once, and dead afterwards. Both swapped
expressions must be pure (a name or a dotted attribute), because the tuple
form evaluates each of them one more time than the original — and on a board,
an extra evaluation can mean an extra bus transaction. That purity rule is
also why `data[i]`/`data[j]` swaps are left alone: `__getitem__` is a call.
