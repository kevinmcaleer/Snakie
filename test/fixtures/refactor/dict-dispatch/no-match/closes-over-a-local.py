# Every branch value is pure, but `scale` is the outer function's parameter. A
# module-level table would be built at import time, where `scale` does not exist.


def make_curve(scale):
    def duty_for(mode):
        if mode == "crawl":
            return scale
        elif mode == "cruise":
            return scale * 2
        elif mode == "sprint":
            return scale * 4
        else:
            return 0

    return duty_for
