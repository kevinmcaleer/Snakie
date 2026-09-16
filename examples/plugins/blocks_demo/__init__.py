"""Example Snakie plugin: blocks contributed to the palette.

Demonstrates the ``@plugin.blocks`` API (#1017, epic #1007). A plugin returns
block DESCRIPTIONS — not code that runs on the canvas — and Snakie turns each
one into a real Blockly block with a real MicroPython generator behind it. They
appear in the **Plugins** category, in a drawer named after the provider.

The motivating case is a classroom or a club with its own robot. The shape of
``robot.forward(50)`` is not something the core palette can know about, and
nobody should have to fork an Electron app to teach it. A plugin here, or a
``blocks.yml`` beside a part (see ``docs/writing-plugins.md``), and the blocks
are simply there next term.

**A block is data.** ``code`` is a template with ``{NAME}`` holes naming the
arguments; filling it can only ever produce a string. Your plugin is asked for
its blocks once, when the toolbox is built — it does not run while a learner
drags, and it cannot reach the device.

Copy this into ``~/.snakie/plugins/`` as a scaffold.

Desktop-only by nature: it runs in the Python host, which the web build (#267)
does not have. A part's ``blocks.yml`` works everywhere and is the right home
for blocks that belong to a piece of hardware rather than to a curriculum.
"""

from snakie import block, plugin

#: The module a school's own robot helper would live in, on the board.
ROBOT_MODULE = "clubbot"


@plugin.blocks("Club robot")
def club_robot_blocks():
    """The blocks for one imaginary club robot.

    Each one generates the code we would teach: a qualified call through one
    import, so a learner who graduates to Python (#1016) can see where every
    name came from.
    """
    imports = [{"module": ROBOT_MODULE}]
    return [
        # A statement with a numeric socket. `default` fills the socket with a
        # shadow block, so the block WORKS the moment it is dragged out rather
        # than presenting a hole a beginner has to discover how to fill.
        block(
            "forward",
            "drive forward %1 cm",
            f"{ROBOT_MODULE}.forward({{CM}})\n",
            args=[{"name": "CM", "kind": "number", "default": 20}],
            imports=imports,
            tooltip="Drive the club robot forward.",
        ),
        block(
            "turn",
            "turn %1 by %2 degrees",
            f"{ROBOT_MODULE}.turn({{DIR}} * {{DEG}})\n",
            args=[
                # A dropdown whose values are written into the Python VERBATIM,
                # which is what lets one block cover both directions without a
                # second generator or an `if` on a string.
                {
                    "name": "DIR",
                    "kind": "choice",
                    "options": [["right", "1"], ["left", "-1"]],
                },
                {"name": "DEG", "kind": "number", "default": 90},
            ],
            imports=imports,
            tooltip="Turn on the spot.",
        ),
        # A VALUE block: it plugs into a socket instead of stacking, so it can be
        # dropped straight into an `if` or a `wait until`.
        block(
            "bumped",
            "bumper pressed",
            f"{ROBOT_MODULE}.bumper()",
            shape="value",
            output="Boolean",
            imports=imports,
            tooltip="True while the front bumper is pressed.",
        ),
        # `setup` hoists a construction above the program and hands its name
        # back as `{SETUP}`. Two blocks with the same `key` share ONE object —
        # which is the difference between opening a serial port once and opening
        # it on every pass of a loop.
        block(
            "say",
            "say %1 on the display",
            "{SETUP}.text({WHAT}, 0, 0)\n{SETUP}.show()\n",
            args=[{"name": "WHAT", "kind": "text", "default": "hello"}],
            setup={
                "key": "clubbot-screen",
                "name": "screen",
                "expr": f"{ROBOT_MODULE}.Screen()",
            },
            imports=imports,
            tooltip="Write a line on the robot's little screen.",
        ),
    ]
