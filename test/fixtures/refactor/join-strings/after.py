"""Format telemetry for the serial link."""


def csv_row(readings):
    parts = []
    for reading in readings:
        parts.append("%d," % reading)
    line = "".join(parts)
    return line.rstrip(",")


def level_bar(level):
    parts = []
    for step in range(level):
        parts.append("#")
    bar = ''.join(parts)
    return bar


class Logger:
    def dump(self, rows):
        parts = []
        for row in rows:
            parts.append(row + "\n")
        text = "".join(parts)
        return text
