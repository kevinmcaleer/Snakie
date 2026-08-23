"""`base` is rewritten before the reader, so the sum would come out different."""


def offset(base, span):
    edge = base + span
    base = 0
    return edge, base
