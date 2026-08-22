def blend(a, b, mix):
    if mix > 0.5:
        out = a
    else:
        out = b
    return out


def set_led(led, fault):
    if fault:
        led.red()
        led.brightness(100)
    else:
        led.green()
        led.brightness(20)
