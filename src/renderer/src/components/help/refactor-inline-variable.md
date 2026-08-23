This name is used once and says no more than the expression — inline it.

```python
def duty_for(angle):                def duty_for(angle):
    span = MAX_DUTY - MIN_DUTY          return MIN_DUTY + (MAX_DUTY - MIN_DUTY) * angle // 180
    return MIN_DUTY + span * angle // 180
```

The mirror image of rule 9. A name earns its keep when it says something the
expression does not, or when it saves the reader from working the same thing
out twice. A name used exactly once, that says no more than the expression it
holds, does neither — it just puts a step between the reader and the answer.
Removing it is how you tell whether the name was pulling its weight: if the
inlined line is harder to read, the name was doing real work and you keep it.

**The trap Snakie spends most of its effort on** is what the expression
*sees*. Moving `speed + step` down to where the variable was used means it is
evaluated later, so anything that rewrites `speed` in between changes the
answer:

```python
step = base + rate
while base < LIMIT:
    base = base + step     # inlining `step` here would compound the climb
```

So every name the expression reads has to be provably untouched between the
assignment and the use — and when the use sits inside a loop, "in between"
means the whole loop, because the second pass runs the body's later lines
first. A `global` declaration anywhere in the file is a refusal for the same
reason: some call in between could be rewriting the name without naming it.

The value must also be **pure**. Inlining `raw = sensor.read_u16()` moves a
hardware read to a different moment, which is a change to the program, not a
tidy-up.
