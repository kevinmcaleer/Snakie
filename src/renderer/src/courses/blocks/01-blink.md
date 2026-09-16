# Make a light blink

Every first program in electronics does the same thing: it makes something
happen that you can see from across the room.

The blocks on the canvas say it out loud:

> **forever** — **toggle LED on GP15** — **wait 400 milliseconds**

*Toggle* means "flip it": on becomes off, off becomes on. Do that forever, with a
pause each time round, and you have a blink.

## Try it

Press **Run**. With no board plugged in, Snakie runs your program on the
simulator, so this works on any computer.

Now look at the **Python** on the right. It says exactly what the blocks say:

```python
while True:
    pin_15.toggle()
    time.sleep_ms(400)
```

You didn't write that by typing it — but you did write it.

## Change something

- Make the pause **50** instead of 400. What happens to the blink?
- Make it **2000**. Is it still blinking, or is it something else now?

Watch the Python change as you do. That number in the blocks and that number in
the code are the same number.
