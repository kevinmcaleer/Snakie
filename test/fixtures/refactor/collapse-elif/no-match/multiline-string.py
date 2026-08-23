"""Dedenting the branch would eat the indentation inside the banner text."""


def banner(state):
    if state == "ready":
        print("ready")
    else:
        if state == "fault":
            print("""
    Fault detected.
    Check the motor driver wiring.
""")
        else:
            print(state)
