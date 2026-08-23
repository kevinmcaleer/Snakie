"""Braces that are part of the text, not placeholders.

Every one of these would have to be doubled to survive inside an f-string, and
a JSON payload the board sends over MQTT is not something to get wrong.
"""


def command(name):
    return '{"cmd": "%s"}' % name


def envelope(topic, body):
    return '{"topic": "%s", "body": %s}' % (topic, body)


def escaped(name):
    return "\\{}".format(name)


def already_an_fstring(name, angle):
    return f"{name} at {angle}"
