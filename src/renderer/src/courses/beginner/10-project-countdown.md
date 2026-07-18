## Project: countdown light 🚦

Let's build a little countdown, like a rocket launch! The number counts down from 5, the light blinks each time, and then... "Go!"

Here's what the starter code does:

- `led = Pin(25, Pin.OUT)` — sets up pin 25 as an output, ready to control a light.
- `for i in range(5, 0, -1):` — counts backwards: 5, 4, 3, 2, 1. The `-1` is the step that goes *down*.
- Inside the loop we `print(i)`, flip the light with `led.toggle()`, then wait half a second with `time.sleep_ms(500)`.
- After the loop finishes, it prints `"Go!"`.

### Try it

1. The simulated device auto-connects — press Run ▶.
2. Watch the console count 5, 4, 3, 2, 1, then "Go!".
3. Open the **Board View** to see pin 25 blink as the light toggles.

### Now you

Make it a *bigger* rocket! Change `range(5, 0, -1)` to `range(10, 0, -1)` so it counts down from 10. Can you also change `500` to `1000` to make each blink last a whole second?

> You just combined pins, loops, and timing into one real program — string a few of these together and you're steering a robot.
