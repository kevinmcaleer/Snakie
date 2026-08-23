def mode_led(led, mode):
    if led is not None:
        if mode == "run":
            led.green()
            led.brightness(40)
        elif mode == "fault":
            led.red()
            led.brightness(100)
