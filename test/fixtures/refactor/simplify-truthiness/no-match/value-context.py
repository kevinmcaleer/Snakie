"""The count's own value is kept, so the list itself is not a substitute."""


def summarise(rows, faults, telemetry):
    # `len(rows) > 0` is a bool; `rows` is a list. The receiver wants the bool.
    telemetry["has_rows"] = len(rows) > 0
    telemetry["clean"] = len(faults) == 0
    telemetry.send(len(rows) != 0)
    return len(faults) >= 1


def flags(readings):
    return {"empty": len(readings) < 1, "full": len(readings) >= 1}
