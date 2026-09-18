# buckets: class, @property, self.x assign, subscript assign, tuple assign, star import
from framebuf import FrameBuffer, MONO_HLSB


class Sprite:
    def __init__(self, width, height, data):
        self.width = width
        self.height = height
        self.data = bytearray(data)
        self.buffer = FrameBuffer(self.data, width, height, MONO_HLSB)
        self.x = 0
        self.y = 0

    @property
    def size(self):
        return (self.width, self.height)

    def move(self, x, y):
        self.x = x
        self.y = y

    def blit(self, target):
        target.blit(self.buffer, self.x, self.y)
