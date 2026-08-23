"""Format telemetry for the serial link."""


def csv_row(readings):
    line = ""
    for reading in readings:
        line += "%d," % reading
    return line.rstrip(",")


def level_bar(level):
    bar = ''
    for step in range(level):
        bar += "#"
    return bar


class Logger:
    def dump(self, rows):
        text = ""
        for row in rows:
            text += row + "\n"
        return text
