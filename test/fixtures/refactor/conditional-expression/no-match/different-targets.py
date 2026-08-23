"""The two branches bind different places, so there is no single assignment."""


def split(sample, limit, buf):
    if sample > limit:
        top = sample
    else:
        bottom = sample
    if sample > limit:
        buf[0] = sample
    else:
        buf[1] = sample
    if sample > limit:
        buf[0], buf[1] = sample, limit
    else:
        buf[0], buf[1] = limit, sample
    return buf
