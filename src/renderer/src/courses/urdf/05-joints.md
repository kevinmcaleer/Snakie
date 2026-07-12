## Connect with a joint 🔩

You've built two parts. Now let's link them with a **joint** so one can move against the other, like an elbow bending or a drawer sliding out.

A joint always connects a **parent** part (stays put) to a **child** part (the one that moves). Picking the right joint type decides *how* it moves.

- **Revolute** = spins around a hinge (a wheel, a wrist, a door).
- **Prismatic** = glides in a straight line (a lift, a drawer, a piston).
- **Fixed** = glued solid, no movement — handy for decoration.

### Try it

1. Open the **Robot View** and find the **build panel** on the left.
2. Click the **Join tool**, then click your parent part, then the child part.
3. In the joint settings, choose **Revolute** for a spin (or **Prismatic** for a slide).
4. Use the Join tool to **mate the faces** so the parts snap together neatly.
5. Drag the **posing slider** and watch your child part move!

### Now you

Set **joint limits** so it can't go too far. Try a min of `-45` and a max of `45` degrees, then drag the slider again — feel it stop at the edges.

> The parent holds still, the child does the moving — pick your parent first!
