"""Telemetry for the line-following rover."""


def publish(link, reading):
    if link.connected and reading > 0:
        link.send(reading)
        link.flush()


def arm(rover):
    if rover.armed and not rover.estop:
        # The e-stop wins over everything else.
        rover.enable_motors()
        rover.beep(2)


def steer(sensor, bias):
    if sensor.ready and (bias < -30 or bias > 30):
        correct(bias)


def flash(led, mode, ticks):
    if led is not None and mode == "blink" and ticks % 2 == 0:
        led.on()
        sleep_ms(40)
        led.off()


def store_sample(buffer, sample):
    if buffer is not None and sample.valid:
        buffer.append(sample)
        buffer.trim(200)
