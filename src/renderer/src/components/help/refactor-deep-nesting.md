This block is nested deeply — extracting the inner part would flatten it.

```python
# before — five levels in, and the line that matters is the hardest to see
def log_run(readings, log):
    for reading in readings:
        if reading.valid:
            for sample in reading.samples:
                if sample > LIMIT:
                    log.write(sample)

# after — the inner test moves out and gets a name
def log_run(readings, log):
    for reading in readings:
        if reading.valid:
            record_overshoots(reading, log)
```

Every level of indentation is a condition the reader has to keep in their
head, and by the fourth one the interesting line is also the least readable.
Pulling the inner block out into a named function replaces four remembered
conditions with one name.

Snakie **only points at this** — it makes no change on its own. An automatic rewrite would have
to invent a function name and work out which locals to pass and return, and
getting either wrong changes behaviour, so the choice stays with the person
who knows what the block is for. Extract Function ("Extract into a function") is the tool that
does the move once they have decided.

Depth is counted **locally** rather than with `nestingDepth` from `engine.ts`,
for two reasons that both come down to matching what the reader sees:

- an `elif` is a peer of its `if`, not a level deeper, even though the AST
  nests it inside the parent's `orelse`;
- an `except` body sits at the same indentation as its `try` body, so the
  handler adds one level between them, not two.

Both differences would otherwise invent nesting the file does not have, and a
false "this is too deep" is exactly the hint that teaches people to ignore
hints.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
