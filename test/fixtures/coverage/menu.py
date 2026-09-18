# buckets: class, method, self.x assign, subscript read, in, early return
class Menu:
    def __init__(self, items):
        self.items = items
        self.cursor = 0

    def down(self):
        self.cursor += 1
        if self.cursor >= len(self.items):
            self.cursor = 0

    def up(self):
        self.cursor -= 1
        if self.cursor < 0:
            self.cursor = len(self.items) - 1

    def current(self):
        return self.items[self.cursor]

    def has(self, name):
        return name in self.items
