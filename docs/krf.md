# KRF — Kev's Robot File

KRF is Snakie's standard folder layout for a **robot project**: the wiring, the
MicroPython code, and the 3D model, together in one folder that the Board View
and Robot View (epic #309) both understand.

```
my-robot/
├── robot.yml      # manifest: wiring + the robot MODEL (below)
├── code/          # MicroPython source
├── urdf/          # .urdf + meshes/ (STL, DAE)
└── stl/           # 3D-printable files
```

`New Robot Project` in Snakie scaffolds this structure; Robot View
auto-discovers `robot.yml` in the workspace root.

## `robot.yml`

`robot.yml` already describes the board + placed parts + wiring (see
`src/shared/robot.ts`). KRF adds an **optional** `robot:` section for the 3D
model — a legacy wiring-only `robot.yml` is unaffected (every new field is
optional and validated corruption-safe).

```yaml
name: My Robot
board: pico2w
parts: [...]          # existing wiring
connections: [...]    # existing wiring

robot:                # ← the KRF robot MODEL (optional)
  version: 1
  urdf: urdf/robot.urdf
  servoJointMap:      # servo pin ↔ URDF joint, with angle calibration
    - pin: GP0
      joint: shoulder
      servoMin: 0     # servo input sweep (deg) — default 0..180
      servoMax: 180
      jointMin: -90   # joint output range (deg for revolute, mm for prismatic)
      jointMax: 90
      invert: false
  joints:             # per-joint limit overrides (edited in the pose tool)
    shoulder: { min: -80, max: 80 }
  defaultPose:        # applied on load
    shoulder: 0
  poses:              # saved named poses
    - name: home
      values: { shoulder: 0 }
```

### Servo → joint mapping

A running program's servo write drives the mapped joint (Phase 3): the servo
angle is clamped to `servoMin..servoMax`, optionally inverted, and lerped onto
`jointMin..jointMax`. Pure implementation + tests: `src/shared/krf.ts`
(`servoToJoint`), `test/krf.test.ts`.

## Versioning

`robot.version` is bumped on breaking changes; `sanitiseRobotModel` migrates /
drops unknown shapes without throwing. Current version: **1**.

## Scope

KRF is the folder + manifest contract for the Robot View epic (#309): the URDF
viewer, pose tool, servo↔joint binding, motion timeline and URDF builder all
read/write this one `robot.yml`. Physics, IK and serial-bus servos are
explicitly out of scope for now.
