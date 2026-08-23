This function is long enough that its parts are hard to hold in your head at once.

```python
def run():                       def run():
    # --- set up the pins ---        pins = setup_pins()
    ...  18 lines ...               calibrate(pins)
    # --- calibrate ---              drive_loop(pins)
    ...  22 lines ...
    # --- drive ---
    ...  28 lines ...
```

Length on its own is not a bug, and Snakie is careful not to pretend it is.
What a long function costs you is *working memory*: to change line 60 you have
to hold what lines 1–59 did to every variable still in play. A function you can
see all of at once is one you can reason about without a notebook.

The useful part of the hint is not the number, it is **where the seams are**.
A function that has grown past forty lines has almost always already been
divided by its author — with a blank line, or with a `# ---- calibrate ----`
heading. Those are the author telling you where the parts start, and each part
is usually a function with a name waiting to be given to it. So the message
counts them and says so.

**Hint only.** Cutting a function up means choosing what each half is called
and which locals cross the boundary, and getting either wrong changes
behaviour — that is Extract Function's job ("Extract into a function"), driven by a human who
knows what the block is *for*. Snakie makes no change, so this never lands in
"Tidy this file". The threshold is `settings.longFunctionLines`, so a person
who disagrees with forty can say so instead of learning to ignore the hint.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
