"""Snakie Turtle — Logo-style turtle graphics as plain MicroPython functions.

Copy this file onto your MicroPython board (or just use it in the Simulator)
and ``import`` it. There is no separate Logo language and no special REPL:
turtle commands are ordinary Python function calls, so everything you already
know about variables, loops and functions applies straight away::

    from turtle import forward, right

    for _ in range(4):
        forward(50)
        right(90)

Like ``instruments.py`` this is a TELEMETRY library, not a driver: each call
that changes the turtle's state prints ONE ``SNK TURT ...`` line and the IDE's
Turtle instrument parses the broadcast serial stream to draw the picture — so
it works non-invasively, even inside a running program, and identically
whether the code is executing on real hardware or in the browser simulator.

Coordinate + heading conventions (deliberately NOT the same as CPython's
``turtle`` module — see the Snakie docs for why)::

    * heading 0 points UP (north/away from you); angles increase CLOCKWISE,
      so right(90) faces east — exactly like turning right in real life.
    * the origin (0, 0) is the CENTRE of the canvas; x increases right,
      y increases UP.

The telemetry protocol
-----------------------

One ``print()`` per state change, ASCII, space-delimited::

    SNK TURT POS  <x> <y> <heading>              # position/heading update
    SNK TURT LINE <x1> <y1> <x2> <y2> <colour> <width>  # a drawn segment
    SNK TURT PEN  <0|1>                          # pen up(0) / down(1)
    SNK TURT VIS  <0|1>                          # turtle hidden(0) / shown(1)
    SNK TURT CLEAR                               # wipe the canvas

``<colour>`` is whatever ``pencolor()`` was given (a CSS colour name or a
``#rrggbb`` hex code), with any spaces replaced by ``_`` so it stays one
token on the wire.
"""

SENTINEL = "SNK"

# Library version. Bump this on ANY change to this file — mirrors
# `instruments.py`'s convention so a future "board library outdated" check can
# reuse the same comparison.
__version__ = "0.1.0"

_DEFAULT_COLOUR = "black"
_DEFAULT_WIDTH = 2


def _fmt(n):
    """Format a coordinate/angle compactly: an int stays bare, a float rounds
    to 3 decimal places (plenty for a screen) so ``SNK TURT`` lines stay short.
    Pure + side-effect-free so it is unit-testable under CPython.
    """
    if isinstance(n, bool):
        return "1" if n else "0"
    if isinstance(n, int):
        return str(n)
    r = round(n, 3)
    if r == int(r):
        return str(int(r))
    return str(r)


def _colour_token(colour):
    """Encode a colour name/hex as a single ASCII token (spaces -> '_')."""
    return str(colour).replace(" ", "_")


class Turtle:
    """One turtle: tracks position/heading/pen state and emits ``SNK TURT``
    telemetry on every change. Most programs use the module-level functions
    (below), which drive a single shared :data:`_default` instance; construct
    your own :class:`Turtle` for more than one on screen at once.
    """

    def __init__(self):
        self.x = 0.0
        self.y = 0.0
        self.heading = 0.0  # compass: 0 = north/up, clockwise positive
        self.pen = True
        self.colour = _DEFAULT_COLOUR
        self.width = _DEFAULT_WIDTH
        self.visible = True
        self._speed = 6
        self._announce_pos()

    def _announce_pos(self):
        print("%s TURT POS %s %s %s" % (SENTINEL, _fmt(self.x), _fmt(self.y), _fmt(self.heading)))

    def _move_to(self, nx, ny):
        """Move to ``(nx, ny)``, drawing a line first if the pen is down."""
        if self.pen:
            print(
                "%s TURT LINE %s %s %s %s %s %s"
                % (
                    SENTINEL,
                    _fmt(self.x),
                    _fmt(self.y),
                    _fmt(nx),
                    _fmt(ny),
                    _colour_token(self.colour),
                    _fmt(self.width),
                )
            )
        self.x = nx
        self.y = ny
        self._announce_pos()

    # --- movement ----------------------------------------------------------

    def forward(self, distance):
        """Move ``distance`` units along the current heading, drawing if the
        pen is down."""
        import math

        rad = math.radians(self.heading)
        # Compass heading (0 = +y/north, clockwise positive):
        #   dx = sin(heading), dy = cos(heading)
        self._move_to(self.x + distance * math.sin(rad), self.y + distance * math.cos(rad))

    def backward(self, distance):
        """Move ``distance`` units opposite the current heading, without
        turning."""
        self.forward(-distance)

    def right(self, angle):
        """Rotate clockwise by ``angle`` degrees."""
        self.heading = (self.heading + angle) % 360
        self._announce_pos()

    def left(self, angle):
        """Rotate anticlockwise by ``angle`` degrees."""
        self.right(-angle)

    # --- pen -----------------------------------------------------------

    def penup(self):
        """Lift the pen — further movement leaves no trail."""
        self.pen = False
        print("%s TURT PEN 0" % SENTINEL)

    def pendown(self):
        """Lower the pen — further movement draws a line."""
        self.pen = True
        print("%s TURT PEN 1" % SENTINEL)

    def pencolor(self, colour):
        """Set the line colour (a CSS colour name or ``#rrggbb`` hex)."""
        self.colour = colour

    def pensize(self, width):
        """Set the line width in pixels."""
        self.width = width

    # --- state and positioning ------------------------------------------

    def home(self):
        """Return to the centre, at the starting (north) heading."""
        self.goto(0, 0)
        self.setheading(0)

    def goto(self, x, y):
        """Jump to the absolute coordinate ``(x, y)``, drawing if pen is down."""
        self._move_to(float(x), float(y))

    def setheading(self, angle):
        """Point in an absolute compass direction (0 = north, clockwise)."""
        self.heading = float(angle) % 360
        self._announce_pos()

    def clear(self):
        """Wipe drawn lines, leaving the turtle's position/heading as-is."""
        print("%s TURT CLEAR" % SENTINEL)

    def reset(self):
        """Clear the canvas and return home, in one call."""
        self.clear()
        self.home()

    def speed(self, value=None):
        """Get/set the animation pace (a small int, or a CPython-turtle-style
        name like ``"fast"``/``"slow"``); the IDE's Turtle instrument uses this
        to pace its draw animation. Returns the current speed when called with
        no argument."""
        if value is None:
            return self._speed
        self._speed = value
        return None

    def hideturtle(self):
        """Hide the turtle sprite (handy for a finished drawing)."""
        self.visible = False
        print("%s TURT VIS 0" % SENTINEL)

    def showturtle(self):
        """Show the turtle sprite."""
        self.visible = True
        print("%s TURT VIS 1" % SENTINEL)

    def position(self):
        """Return the current ``(x, y)``."""
        return (self.x, self.y)


# ---------------------------------------------------------------------------
# Module-level API — the shared default turtle most programs use directly, so
# `forward(10)` / `right(90)` just work without instantiating a Turtle.
# ---------------------------------------------------------------------------

_default = Turtle()


def forward(distance):
    _default.forward(distance)


def backward(distance):
    _default.backward(distance)


def right(angle):
    _default.right(angle)


def left(angle):
    _default.left(angle)


def penup():
    _default.penup()


def pendown():
    _default.pendown()


def pencolor(colour):
    _default.pencolor(colour)


def pensize(width):
    _default.pensize(width)


def home():
    _default.home()


def goto(x, y):
    _default.goto(x, y)


def setheading(angle):
    _default.setheading(angle)


def clear():
    _default.clear()


def reset():
    _default.reset()


def speed(value=None):
    return _default.speed(value)


def hideturtle():
    _default.hideturtle()


def showturtle():
    _default.showturtle()


def position():
    return _default.position()


# Short aliases, kept for anyone porting CPython `turtle` code (`fd`/`bk`
# etc. are its own conventional short names, unrelated to classic Logo).
fd = forward
bk = backward
back = backward
rt = right
lt = left
pu = penup
pd = pendown
