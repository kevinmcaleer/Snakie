"""The matching pair is an `elif` and its `else`, which is a chain, not a
two-way choice."""


def mode_led(mode, led):
    if mode == "run":
        led.on()
    elif mode == "idle":
        led.toggle()
    else:
        led.toggle()
