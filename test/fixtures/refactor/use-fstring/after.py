"""Serial telemetry for the rover."""


def report(name, angle):
    print(f"{name} at {angle}")


def log_line(uart, motor):
    uart.write(f"speed {motor.speed}\n")
    uart.write(f"heading {motor.heading}, pitch {motor.pitch}\n")


def banner(machine_name, version):
    return f"Snakie on {machine_name} ({version})"


def status(sensor):
    print(f'left {sensor.left} right {sensor.right}')
