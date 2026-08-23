"""`stop()` is free to zero the attribute, so the old reading is not the new one."""


class Rover:
    def coast(self):
        was = self.speed * 2
        self.stop()
        self.log(was)
