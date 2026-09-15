Logo-style turtle graphics — plain MicroPython functions, no separate language.

## What it shows

A turtle drawing on a canvas: it moves and turns as your program calls
`forward()`/`right()`/etc, tracing a line while the pen is down. The readout
strip shows the turtle's current **X / Y / HEADING / PEN** state.

**Heading and coordinates deliberately differ from CPython's `turtle` module**:
heading `0` points **up** (north) and increases **clockwise**, so
`right(90)` faces east — like turning right in real life. The origin
`(0, 0)` is the **centre** of the canvas, and **y increases up**.

## How to use it

```python
from turtle import forward, right

for _ in range(4):
    forward(50)
    right(90)
```

If running this gives `ImportError: no module named 'turtle'`, the library
isn't on your board yet — connect it and Snakie offers a one-click **Download
& install** banner at the top of the window (the same way it offers to
install the instruments library). It installs `/lib/turtle.py`.

There is no separate REPL or parser — `forward(10)` is an ordinary Python
call, so loops, variables and functions all work as normal. Import from
`turtle` (or `import turtle as t` and call `t.forward(10)`) to draw with the
shared default turtle; construct your own `turtle.Turtle()` for more than one
turtle on screen at once.

## Commands

| Function | Behaviour |
| --- | --- |
| `forward(distance)` / `backward(distance)` | Move along (or against) the current heading |
| `right(angle)` / `left(angle)` | Turn clockwise / anticlockwise, degrees |
| `penup()` / `pendown()` | Lift / lower the pen |
| `pencolor(colour)` / `pensize(width)` | Set line colour / width |
| `goto(x, y)` / `setheading(angle)` | Jump to an absolute position / direction |
| `home()` / `reset()` | Return to centre / clear + return to centre |
| `clear()` | Wipe the drawing, keep the turtle where it is |
| `hideturtle()` / `showturtle()` | Toggle the turtle sprite |
