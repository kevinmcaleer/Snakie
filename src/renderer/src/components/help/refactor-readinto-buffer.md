`read()` allocates a new bytes object every pass — `readinto()` reuses one.

```python
# before                                # after
with open(path, "rb") as f:             with open(path, "rb") as f:
    for _ in range(blocks):                 block = bytearray(64)
        block = f.read(64)                  for _ in range(blocks):
        total += checksum(block)                f.readinto(block)
                                                total += checksum(block)
```

## Why it matters

`read(n)` **allocates a fresh `bytes` object every call**. It
asks the heap for n bytes, copies the data in, hands it to you — and the
moment the next pass overwrites the variable, that object becomes garbage.
A sampling loop reading 64 bytes at 200 Hz is asking the allocator for 12 KB
a second, all of it rubbish a millisecond later.

`readinto(buf)` writes into memory **you** allocated once, before the loop
started. Same bytes, same code shape, no allocation and nothing for the
collector to sweep. In a sampling loop that is the difference between a steady
rate and a stall every time the collector runs — and the stall is the sort that
shows up as a dropped sample or a missed encoder edge, which looks exactly like
a hardware fault and is not one.

Two things change, which is why this is an assisted rewrite and never a silent
one. `readinto()` returns **the number of bytes it actually read**, not the
data, so a short read no longer shortens the buffer — the tail simply keeps
last pass's bytes. And the buffer is now one object reused every iteration, so
anything that *keeps* it — appending it to a list, filing it in a dict, handing
it to another name — would end up with a pile of references to the same
bytearray, every one of them showing the final read. The rule refuses in all of
those cases: it only fires when the buffer plainly lives and dies inside one
pass of the loop, and when the loop is not already inspecting it for a short
read.

Gated on a board being connected at all. This is on-device advice about the
heap on the chip in front of you, and Snakie says nothing about a board it
cannot see.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
