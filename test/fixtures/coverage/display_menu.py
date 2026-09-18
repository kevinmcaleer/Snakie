# buckets: self.x.y() call, class, method, subscript read, f-string
class Screen:
    def __init__(self, display, menu):
        self.display = display
        self.menu = menu
        self.row_height = 10

    def draw(self):
        self.display.fill(0)
        for index in range(len(self.menu.items)):
            label = self.menu.items[index]
            y = index * self.row_height
            if index == self.menu.cursor:
                self.display.text(f"> {label}", 0, y)
            else:
                self.display.text(f"  {label}", 0, y)
        self.display.show()
