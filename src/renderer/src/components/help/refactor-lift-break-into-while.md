This `while True:` breaks on its first line — that test is the loop condition.

```python
while True:                          while sonar.distance_cm() >= 15:
    if sonar.distance_cm() < 15:         rover.forward(40)
        break                            time.sleep_ms(50)
    rover.forward(40)
    time.sleep_ms(50)
```

`while True:` tells the reader nothing, so they have to scan the body for the
`break` that actually ends it. When that `break` is the very first thing in
the loop it *is* the loop condition, just written a line too late — hoisting
it into the `while` puts the reason the loop stops where a reader looks for
it, and drops two lines and an indent level on the way.

The condition is tested at the top of the cycle either way, so a condition
that touches hardware (`sonar.distance_cm()`) is evaluated exactly as often
as before. What we do decline is a `while … else:` — its `else` is dead code
under `while True:` and would spring to life once the loop can end normally —
and any loop containing a `continue`, where proving the two forms take the
same path back to the top is more than Snakie is willing to claim.
