This loop indexes two sequences in step — `zip` hands you the items directly.

```python
for i in range(len(readings)):       for reading, gain in zip(readings, gains):
    out.append(readings[i] * gains[i])    out.append(reading * gain)
```

`range(len(...))` is the C loop a beginner brings with them: an index whose
only job is to get back to the items. Every `readings[i]` is a bounds check
and a lookup, and the code has to be read twice to see that the two lists are
being walked in step. `zip` says that outright, hands the items straight to
the body, and drops the index nobody wanted.

The rule only fires when **two or more** sequences are indexed by the same
variable — one sequence is `enumerate`'s job ("Iterate directly"), not `zip`'s — and
only when the index is used for *nothing else*: one stray `print(i)` or
`readings[i + 1]` and there is no faithful rewrite, so it declines.

Two more refusals, both about proving equivalence: the sequence the `len` was
taken from must itself be one of the indexed ones (otherwise the loop count
and `zip`'s shortest-wins length are unrelated), and nothing in the body may
assign through the index — `readings[i] =...` writes back into the list,
which a `zip` variable cannot do.

One difference worth naming: where the lists are ragged, the original raises
`IndexError` on the short one and `zip` quietly stops at it. That is the
conventional reading of this refactoring — walking sequences in step is only
meaningful while they are in step — and it is why the "Why?" article says so
out loud.
