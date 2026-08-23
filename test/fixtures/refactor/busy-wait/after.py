"""Wait for the encoder interrupt to raise the flag."""

ready = False


def wait_for_sample():
    while not ready:
        pass
    return read_sample()


def wait_for_button(button):
    while button.value():
        continue
    return True
