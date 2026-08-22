"""The rover's behaviour controller — a hand-written finite state machine.

Six `StateMachine(...)` constructions, none of which is a PIO state machine.
The name belongs to the class defined below, so the PIO budget is untouched.
"""
import time
from machine import Pin

bumper = Pin(10, Pin.IN, Pin.PULL_UP)


class StateMachine:
    """A tiny behaviour FSM: a name, an entry action and a tick."""

    def __init__(self, name, on_enter, on_tick):
        self.name = name
        self.on_enter = on_enter
        self.on_tick = on_tick

    def enter(self):
        self.on_enter(self)

    def tick(self):
        return self.on_tick(self)


def announce(state):
    print("entering", state.name)


idle = StateMachine("idle", announce, lambda s: "search")
search = StateMachine("search", announce, lambda s: "approach")
approach = StateMachine("approach", announce, lambda s: "grab")
grab = StateMachine("grab", announce, lambda s: "deliver")
deliver = StateMachine("deliver", announce, lambda s: "idle")
recover = StateMachine("recover", announce, lambda s: "idle")

STATES = {s.name: s for s in (idle, search, approach, grab, deliver, recover)}

current = idle
current.enter()
for _ in range(10):
    nxt = STATES["recover" if bumper.value() == 0 else current.tick()]
    if nxt is not current:
        current = nxt
        current.enter()
    time.sleep_ms(100)
