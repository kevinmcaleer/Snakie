# buckets: class, self.x assign, self.x.y() call, @property, augmented assign
class Plotter:
    def __init__(self, display, width, height):
        self.display = display
        self.width = width
        self.height = height
        self.samples = []
        self.cursor = 0

    @property
    def full(self):
        return len(self.samples) >= self.width

    def add(self, value):
        self.samples.append(value)
        if self.full:
            self.samples.pop(0)
        self.cursor += 1

    def draw(self):
        self.display.fill(0)
        for x in range(len(self.samples)):
            y = self.height - int(self.samples[x] * self.height)
            self.display.pixel(x, y, 1)
        self.display.show()
