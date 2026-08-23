Sorting to take one end builds a whole new list — `min`/`max` walk it once.

```python
weakest = sorted(rssi)[0]            weakest = min(rssi)
strongest = sorted(rssi)[-1]         strongest = max(rssi)
hottest = sorted(temps, reverse=True)[0]   hottest = max(temps)
```

Sorting to look at one end is the most expensive way to ask a cheap question.
`sorted()` allocates a whole new list the size of the input and then does
O(n log n) comparisons to put every element in its place — and then all but
one of them is thrown away. `min()` and `max()` walk the iterable once, keep a
single reference, and allocate nothing.

On a microcontroller that is the difference between a refactor and a fix: a
500-sample buffer sorted on a Pico costs a second copy of the buffer in RAM
you may not have, and on a fragmented heap that is where `MemoryError` comes
from. `min`/`max` also take an iterator, so the source never has to be a list
at all.

`key=` is carried across unchanged — `min`/`max` take the same argument — and
a literal `reverse=True` simply swaps which end is being asked for. Anything
else (`reverse=flag`, `**options`, a slice rather than an item, any index
other than the two ends) is left alone, because it is no longer the same
question.

The one nuance worth knowing: with ties, `sorted(...)[-1]` hands back the
*last* of the equal elements and `max` the first. For numbers that is
indistinguishable; it is only visible when equal-comparing items are told
apart some other way, which is what the "Why?" article spells out.
