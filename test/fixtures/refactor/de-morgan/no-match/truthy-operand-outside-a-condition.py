"""Outside a condition, `not quiet` must stay a bool, not become `quiet`."""


def report_flag(status, quiet):
    show = not (status == "ok" and not quiet)
    return show


def wants_log(level, silent):
    return not (level == 0 or not silent)


def flags(status, quiet):
    return [not (status == "ok" and not quiet)]
