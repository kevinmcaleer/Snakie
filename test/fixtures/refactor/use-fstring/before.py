"""Serial telemetry for the rover."""


def report(name, angle):
    print("{} at {}".format(name, angle))


def log_line(uart, motor):
    uart.write("speed %s\n" % motor.speed)
    uart.write("heading %s, pitch %s\n" % (motor.heading, motor.pitch))


def banner(machine_name, version):
    return "Snakie on {} ({})".format(machine_name, version)


def status(sensor):
    print('left %s right %s' % (sensor.left, sensor.right))
