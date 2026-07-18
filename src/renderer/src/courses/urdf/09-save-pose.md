## Save a pose 📸

You've been dragging joint sliders to move your robot. A **pose** lets you keep one of those positions — a named snapshot of every joint, ready to use again.

Think of it like a photo. Once you like the way your robot is standing, save it as "stand", "wave", or "crouch". Later you can jump straight back to it instead of nudging every slider by hand.

- A pose remembers *all* your joint numbers at once — arms, legs, everything.
- The name is yours to pick, so make it easy to remember.
- Saved poses live with your robot, right next to its joints.

### Try it

1. Open the **Robot View** and drag the **posing sliders** until your robot looks the way you want.
2. Find the **Pose bench** in the build panel and click **Save pose**.
3. Type a name like `wave` and confirm.
4. Now drag the sliders somewhere silly, then click your saved **wave** pose — snap, it's back!

### Now you

Make two poses: one called `up` with a joint high, one called `down` with it low. Click between them and watch your robot flip-flop. Then **Export URDF** to keep them.

> A saved pose isn't just for clicking — your code can call it by name, so "wave" in the editor really waves. 👋
