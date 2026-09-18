# buckets: class, methods, self.x assign, early return, in, print
class Pet:
    MOODS = ["happy", "bored", "hungry"]

    def __init__(self, name):
        self.name = name
        self.mood = "happy"
        self.fed = 0

    def feed(self, amount):
        if amount <= 0:
            return
        self.fed += amount
        self.mood = "happy"

    def tick(self):
        self.fed -= 1
        if self.fed < 0:
            self.mood = "hungry"

    def describe(self):
        print(self.name, self.mood)
