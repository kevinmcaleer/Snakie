# Play a tune

A buzzer is a speaker that only knows one note at a time. Give it a **frequency**
in hertz and a **length** in milliseconds, and it plays.

> **repeat 3 times** — **buzzer on GP16 play 440 Hz for 200 ms** — **then 660 Hz**

440 Hz is the A that orchestras tune to. 660 is roughly the E above it.

## Try it

Press **Run**. Then change the numbers:

- Make the second note **880** — double 440. That is the *same note, an octave
  up*, which is what doubling a frequency always means.
- Add a third `buzzer` block inside the repeat and make a three-note tune.

## What the blocks wrote

```python
for _ in range(3):
    buzzer_16.tone(440, 200)
    buzzer_16.tone(660, 200)
```

`for _ in range(3)` is Python for "do this three times". The `_` is a name that
says *I don't need to know which time round we are*.
