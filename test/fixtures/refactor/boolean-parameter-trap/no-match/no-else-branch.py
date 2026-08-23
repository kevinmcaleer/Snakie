"""A flag that adds an extra step is not the trap — there is one behaviour here,
not two wearing the same name."""


def blink(led, times, announce=True):
    if announce:
        print("blinking", times)
    for _ in range(times):
        led.toggle()
        sleep_ms(100)


def save(path, data, backup=False):
    if backup:
        copy(path, path + ".bak")
    with open(path, "wb") as handle:
        handle.write(data)
