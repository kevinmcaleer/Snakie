Looping over a dictionary already gives you its keys.

```python
for name in servos.keys():        for name in servos:
    print(name)                       print(name)

for name in servos.keys():        for name, value in servos.items():
    servos[name].detach()             value.detach()
```

Iterating a dictionary already yields its keys, so `.keys()` is a call and a
throwaway view object per loop — on a microcontroller that is a real
allocation, and it is the sort of thing that shows up as a mysterious
`MemoryError` in a long-running loop rather than as slowness.

The stronger form matters more. When the body's only use of the key is to
look the value straight back up, the loop is asking the dictionary for the
same entry twice: once to hand you the key, once to hash it again for
`servos[name]`. `.items()` gives you both halves from the one lookup, and the
body stops repeating the container's name on every line.

We decline when the body mutates the dictionary — adding or removing entries
while iterating is a `RuntimeError` waiting to happen, and that code needs a
different conversation, not a tidy-up. The dictionary expression must also be
pure, so `read_config().keys()` is left alone: dropping the `.keys()` there
would still be one call, but the `.items()` form would not be.
