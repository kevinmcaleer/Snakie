## Plot a sensor 📈

A light sensor sends back a number that goes up in bright light and down in the dark. Numbers scrolling past are hard to read, so let's turn them into a picture.

Here's what the starter code does:

- `ADC(26)` reads an **analog** pin — one that gives a whole range of values, not just on/off.
- `sensor.read_u16()` reads the light as a big number from 0 up to 65535.
- The magic word `SNK PLOT light` tells Snakie's **Plotter** to graph the number that follows it, and call the line "light".
- The loop reads and prints every 100 ms, forever.

### Try it

1. The simulated device auto-connects — press **Run ▶**.
2. Numbers race down the **console**. Now open the **Plotter** instrument.
3. Watch a wiggly line draw itself in real time.
4. Wave your hand over the sensor (or drag the light slider in **Board View**) and watch the line dip and climb.

### Now you

Add a second reading! Put another sensor on `ADC(27)` and print `SNK PLOT dark` with its value. The Plotter draws **two** coloured lines at once — spot which one is which.

> A graph turns a river of numbers into a story your eyes can read in a glance.
