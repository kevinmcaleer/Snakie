"""A `continue` never reaches `i += 1`; `for` would advance anyway."""


def send_all(radio, queue, packets):
    i = 0
    while i < packets:
        if queue[i] is None:
            continue
        radio.send(queue[i])
        i += 1
