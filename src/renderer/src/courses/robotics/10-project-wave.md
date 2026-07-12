## Project: wave hello 👋

Time to put it all together! You'll make a servo arm swing back and forth, like it's waving at you.

Here's how the starter code works:

- `arm = Servo(...)` sets up one servo on pin 0 — that's your robot's arm.
- The `for _ in range(3):` loop repeats **3 times**, so the wave happens three times.
- Inside the loop, `arm.angle(60)` then `arm.angle(120)` tips the arm one way, then the other. The `time.sleep_ms(300)` waits between each move so the wave isn't too fast to see.
- At the end, `arm.angle(90)` parks the arm back in the middle, resting.

### Try it

1. Make sure the simulated device is connected (it usually connects on its own).
2. Press **Run ▶**.
3. Open the **Board View** to see pin 0 lighting up as the arm moves.
4. Open the **Pose bench** and watch the servo swing to 60, then 120, three times, then settle at 90.

### Now you

Make it a **big, slow** wave! Change `60` to `30` and `120` to `150`, and change both `300` values to `500`. Press Run again — a wider, friendlier wave.

> One servo, one loop, and a few angles — that's real robot behaviour. Every robot dance starts exactly here.
