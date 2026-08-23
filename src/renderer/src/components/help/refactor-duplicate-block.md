These lines appear more than once — extracting them would fix them in one place.

```python
def start_left():                def start_right():
    pwm_a.freq(50)                   pwm_a.freq(50)
    pwm_a.duty_u16(0)                pwm_a.duty_u16(0)
    pin_a.value(0)                   pin_a.value(0)
    print("left ready")              print("right ready")
```

Three identical lines in two places is three chances to fix a bug in one of
them and not the other. That is the real cost of copy-and-paste, and it is
paid months later: someone changes the PWM frequency, the rover's left wheel
behaves and the right one does not, and nothing in the file says why. A block
with a name is changed once, and every caller gets the change.

Blocks are compared **dedented**, so the same three lines match whether they
sit at the top of a function or two levels inside a loop — the shape of the
code is what repeats, not its indentation. Comments and blank lines inside a
run are part of the comparison: two runs that differ only in their comments
are two blocks that have already started to drift apart, and lumping them
together would be the sort of confident-but-wrong hint that teaches people to
ignore hints.

Runs that repeat for a *reason* are skipped: a stack of `import`s, a row of
`pass` statements, anything under three real lines. And only the longest run
at each place is reported — a six-line repeat should say "six lines", not fire
four times for every three-line window inside it.

**Hint only.** Turning the block into a function means naming it and deciding
what varies between the copies (here, the message), which is exactly the
judgement a tool should not make on its own. Snakie makes no change.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
