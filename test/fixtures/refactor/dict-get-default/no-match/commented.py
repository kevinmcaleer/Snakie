"""The right shape, but folding it onto one line would delete the notes the
author left inside the branches."""


def setting(config, name):
    if name in config:
        value = config[name]
    else:
        # 0 means "leave the wheel alone" to the motor driver.
        value = 0
    return value


def trim(config):
    if "trim" in config:
        offset = config["trim"]  # microseconds, signed
    else:
        offset = 0
    return offset
