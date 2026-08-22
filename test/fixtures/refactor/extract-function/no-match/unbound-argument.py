"""An argument is evaluated before the block's first side effect.

Selecting the last two lines would pass `speed`, which is only bound when
`fast` is true. The call would then raise `UnboundLocalError` *before*
`motor.stop()` ran — the motor keeps turning where the original stopped it and
only then complained. A parameter has to be bound on every path that reaches
the block.
"""


def coast(fast, motor):
    if fast:
        speed = 40
    motor.stop()
    motor.set(speed)
