"""Real length tests — these ask about a size, not about emptiness."""


def parse_frame(payload, header):
    if len(payload) > 1:
        return payload[1:]
    if len(header) == 2:
        return header
    if len(payload) >= 3:
        return payload[3:]
    while len(payload) < 4:
        payload += b"\x00"
    return payload
