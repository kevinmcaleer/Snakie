This loop only adds things up — `sum()` says so in one line.

```python
total = 0                          total = sum(cell.voltage() for cell in cells)
for cell in cells:
    total += cell.voltage()
```

Three lines of bookkeeping collapse into one that says what it means. `sum`
runs its addition in C rather than in the interpreter loop, so on a
microcontroller it is also the faster of the two — and passing a **generator**
rather than a list comprehension matters there: `sum(x for x in xs)` adds as
it goes, while `sum([x for x in xs])` first builds a whole second list in RAM,
which is exactly what you do not want on a board with 264 KB of it.

When the loop body adds the loop variable itself, the generator is redundant
and the answer is simply `total = sum(readings)`.

We decline whenever the starting value is not `0` (`sum` starts from zero, so
`total = offset` is a different sum), whenever the loop carries an `else`
clause, and whenever the loop variable is still read afterwards — a `for` loop
leaks its variable into the enclosing scope and a generator expression does
not, so dropping the loop would unbind a name the code still uses.
