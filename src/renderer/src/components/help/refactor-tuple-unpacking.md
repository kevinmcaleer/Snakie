These lines take consecutive items apart — unpack them in one go.

```python
roll = orientation[0]         roll, pitch, yaw = orientation
pitch = orientation[1]
yaw = orientation[2]
```

Three lines of index bookkeeping become one line that names the parts. The
indices were never the point — they were the cost of getting at the values —
and they are exactly the sort of thing that goes wrong silently when someone
inserts a field: `[1]` and `[2]` both have to move, and a typo produces a
plausible number rather than an error.

Unpacking also states the shape of the data: `roll, pitch, yaw = orientation`
says "this is a triple", and Python enforces it. That is the one behaviour
difference to know about, and it is why the rule checks what it can before
offering: indices must start at 0 with no gaps, and if anything nearby proves
the sequence is longer — a later `orientation[3]`, or a visible literal of a
different length — we decline, because unpacking a 4-tuple into three names
raises `ValueError` where indexing quietly worked.

The indexed expression must be pure, so a `read_imu()[0]`/`read_imu()[1]`
pair is left alone: collapsing it would change three bus reads into one,
which is usually what you want but is emphatically not the same program.
