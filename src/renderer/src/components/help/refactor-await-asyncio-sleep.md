A blocking `sleep()` inside a coroutine stalls the whole event loop.

```python
async def heartbeat(led):        async def heartbeat(led):
    while True:                      while True:
        led.toggle()                     led.toggle()
        time.sleep(0.5)                  await asyncio.sleep(0.5)
```

`time.sleep()` blocks the interpreter. Inside a coroutine that means it blocks
the **whole event loop**: for those 500 ms the sensor poll doesn't run, the
watchdog isn't fed, the web handler never answers and the motor ramp freezes
mid-ramp. `await asyncio.sleep()` yields to the loop instead, so everything
else keeps running while this task waits.

That is a latent bug rather than a style nit —
and it is the single most common thing that goes wrong the first time someone
moves a robot from a `while True:` loop onto asyncio.

The rule stays deliberately narrow. It rewrites only what it can prove: a
blocking sleep from `time`/`utime`, called as a statement, inside an
`async def`, with the asyncio module already imported. Anything else is
reported but not rewritten.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
