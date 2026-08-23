"""Two readers means the name is saving the reader a comparison — it stays."""


def scale(raw, gain):
    factor = gain * 2
    print(raw * factor)
    print(raw // factor)
