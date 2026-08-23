Both branches assign the same name — this is one conditional expression.

```python
if speed > limit:            target = limit if speed > limit else speed
    target = limit
else:
    target = speed
```

Four lines and a branch to say one thing: *this variable gets one of two
values*. Written as a conditional expression the assignment is a single
statement again, the name is bound exactly once (so there is no path where it
is left unset), and the reader sees the choice and its outcome in one glance
instead of holding an `if` open in their head.

The rule is fussy on purpose. Both branches must assign the **same** single
target and nothing else; an augmented (`+=`) or annotated (`x: int =`)
assignment is left alone; an `elif` is left alone (folding one would drop the
branches around it); a comment anywhere in the `if` is left alone, because
collapsing the lines would take the comment with them. And a one-liner that
would run past the repo's 100-column line width is not an improvement — a
wrapped conditional expression is harder to read than the `if` it replaced —
so that declines too.
