import asyncio


async def heartbeat(led):
    while True:
        led.toggle()
        # A coroutine, not time.sleep — rewriting this would stall the loop.
        await asyncio.sleep(0.5)
