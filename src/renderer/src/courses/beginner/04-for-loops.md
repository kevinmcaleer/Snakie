## Repeating with for 🔁

A **for loop** does the same job over and over, without you writing it out lots
of times.

```python
for i in range(5):
    print("count", i)
```

- `range(5)` hands the loop five numbers, one at a time.
- `i` is a box that holds the current number on each turn.
- The indented line runs once for every number — so `print` fires five times.

### Try it

1. Make sure the device says **connected** (the simulator connects on its own).
2. Press **Run ▶**.
3. Watch the console count out five lines:

```
count 0
count 1
count 2
count 3
count 4
```

Notice it started at `0` and stopped *before* `5`.

### Now you

Change `range(5)` to `range(10)` and **Run** again — now it counts ten lines.
The indented line never changed; the loop just repeated more times.

> The indent (those spaces at the start) is what tells Python "this line belongs
> inside the loop." Line it up neatly!
