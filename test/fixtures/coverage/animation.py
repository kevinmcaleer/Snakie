# buckets: async def, await, class, self.x assign, method call on an object
import uasyncio as asyncio


class Frame:
    def __init__(self, pixels, hold):
        self.pixels = pixels
        self.hold = hold


class Player:
    def __init__(self, display):
        self.display = display
        self.playing = False

    async def play(self, frames):
        self.playing = True
        for frame in frames:
            self.display.show(frame.pixels)
            await asyncio.sleep(frame.hold)
        self.playing = False
