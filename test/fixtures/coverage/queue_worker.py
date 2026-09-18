# buckets: async def, await, .append(), while, try/except
import uasyncio as asyncio

jobs = []


def submit(job):
    jobs.append(job)


async def worker(name):
    while True:
        if len(jobs) == 0:
            await asyncio.sleep(0.1)
            continue
        job = jobs.pop(0)
        try:
            await job()
        except Exception:
            print("job failed", name)


async def main():
    await asyncio.gather(worker("a"), worker("b"))
