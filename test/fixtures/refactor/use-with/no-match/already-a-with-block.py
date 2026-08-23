"""Already idiomatic — the rule must not fire on its own output."""


def save_reading(temperature):
    with open("readings.csv", "a") as f:
        f.write("%s\n" % temperature)
        f.flush()


def load_calibration(path):
    with open(path) as f:
        return float(f.readline())


def close_the_port(uart):
    # A `close()` on something that was never `open()`ed is nothing to do with us.
    uart.write(b"bye")
    uart.close()
