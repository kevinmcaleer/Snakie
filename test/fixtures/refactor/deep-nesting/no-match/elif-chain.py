"""An `elif` chain is a peer list, not four levels of nesting."""


def choose_mode(button, mode):
    while True:
        if button.value() == 0:
            mode = "run"
        elif mode == "run":
            mode = "idle"
        elif mode == "idle":
            mode = "sleep"
        else:
            mode = "off"
        yield mode
