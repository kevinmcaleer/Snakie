## Set joint limits 🛑

A joint limit is a fence for a joint. It says "you may turn this far, and no further" — so your robot can't bend a leg backwards or spin a servo past where the real one stops.

Every revolute joint (a hinge) turns around a spot. A prismatic joint (a slider) moves along a line. Without limits they'd keep going forever!

- **Lower limit** — the smallest angle (or distance) allowed.
- **Upper limit** — the biggest allowed.
- The pose slider will only move *between* those two numbers.

### Try it

1. Open the **Robot View** and click a joint you made earlier (a revolute one is easiest).
2. In the build panel, find the **Limits** boxes.
3. Set **Lower** to `-90` and **Upper** to `90`.
4. Drag the **pose slider** all the way left, then all the way right — watch the part stop right at the fence.
5. Try tighter numbers, like `-30` and `45`, and drag again.

### Now you

Give an arm a "no droop" rule: set a shoulder joint's **Lower** to `0` so it can lift up but never sag below level. Then **Export URDF** to save it.

> Real servos have limits too. Matching them here means your robot moves the same on screen as it does on the bench. 🦾
