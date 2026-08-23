class Odometry:
    """`turns` is integer work, but `self` is an object and methods stay bytecode."""

    def __init__(self, ticks_per_turn):
        self.ticks_per_turn = ticks_per_turn

    def turns(self, ticks):
        whole = 0
        while ticks >= 12:
            ticks = ticks - 12
            whole = whole + 1
        return whole
