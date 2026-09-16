# Read a sensor and watch it move

Blinking and beeping are your program *doing*. This is your program *measuring*.

> **forever** — **plot light = read volts on GP26** — **wait 200 ms**

`read volts on GP26` is a **value** block: it sits inside another block rather
than standing on its own, because it doesn't *do* something, it *is* a number.

## Try it

Press **Run**. Two panels open: the **Multimeter** shows the reading as a dial,
and the **Plotter** draws it over time. If you have a light sensor or a
potentiometer on GP26, move it and watch the line move.

## What the blocks wrote

```python
while True:
    inst.plot(light=inst.read_adc(adc_26, ch='adc26'))
    time.sleep_ms(200)
```

Read that inside-out, the way Python runs it: `read_adc` gets the number, then
`plot` draws it. The block was inside the other block; the call is inside the
other call. It is the same shape.
