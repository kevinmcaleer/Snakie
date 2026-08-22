"""Telemetry for the line-following rover."""


def publish(link, reading):
    if link.connected:
        if reading > 0:
            link.send(reading)
            link.flush()


def arm(rover):
    if rover.armed:
        # The e-stop wins over everything else.
        if not rover.estop:
            rover.enable_motors()
            rover.beep(2)


def steer(sensor, bias):
    if sensor.ready:
        if bias < -30 or bias > 30:
            correct(bias)


def flash(led, mode, ticks):
    if led is not None:
        if mode == "blink":
            if ticks % 2 == 0:
                led.on()
                sleep_ms(40)
                led.off()


def store_sample(buffer, sample):
    if buffer is not None:
        if sample.valid:
            buffer.append(sample)
            buffer.trim(200)
