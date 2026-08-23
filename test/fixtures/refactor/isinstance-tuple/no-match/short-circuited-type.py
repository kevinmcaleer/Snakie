"""The second check is only reached when the first fails, so the type it looks
up must not be dragged into a tuple that is built every time."""


def is_frame(value, registry):
    return isinstance(value, Frame) or isinstance(value, registry.frame_type())


def is_known(value, types):
    if isinstance(value, bytes) or isinstance(value, types[0]):
        return True
    return False
