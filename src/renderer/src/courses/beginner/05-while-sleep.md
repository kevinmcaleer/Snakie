## while and sleep ⏳

A `while` loop repeats code again and again, as long as something is true. `time.sleep` puts in a pause so you can watch it happen.

Here's what the starter code does:

- `n = 3` sets a counter to start at 3.
- `while n > 0:` keeps looping while `n` is bigger than 0.
- Each time round, it prints `n`, waits 1 second, then makes `n` one smaller.
- When `n` hits 0, the loop stops and it prints `"Lift off!"`.

It's a rocket countdown!

### Try it

1. Press **Run ▶**.
2. Watch the **console**. See `3`, then `2`, then `1` appear — one per second.
3. Wait for `"Lift off!"` to blast off at the end.

### Now you

Change `n = 3` to `n = 10` for a longer countdown. Then try `time.sleep(0.2)` to make it speedy, or `time.sleep(2)` to make it slow and dramatic.

> A loop that never makes its condition false runs *forever*. If that happens, just press **Stop** ⏹ — you're always in control.
