def sleep(seconds):
    """Our own pacing helper, nothing to do with time.sleep."""
    spin_until(seconds)


def run():
    sleep(0.1)
