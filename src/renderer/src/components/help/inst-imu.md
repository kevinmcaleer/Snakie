A live 3-D orientation viewer for an accelerometer/gyro IMU.

## What it shows
A CSS-3D board model that tilts in real time from roll/pitch/yaw or a quaternion, with body axes, an artificial-horizon band, and a numeric **ROLL / PITCH / YAW** readout. **LEVEL** captures the current pose as zero (calibration); **RESET** clears it. The HUD shows `EULER` or `QUAT` per the source.

## How to use it
Read your IMU (MPU6050, BNO055, …) in a loop and emit orientation. Euler degrees: `inst.imu(roll, pitch, yaw)` → `SNK IMU`. Drift/gimbal-free quaternion: `inst.imu_quat(w, x, y, z)` → `SNK IMUQ`. Both are passive prints, safe inside a tight loop.

## Snippet
```python
import instruments as inst

while True:
    roll, pitch, yaw = read_imu()
    inst.imu(roll, pitch, yaw)
    # or: inst.imu_quat(w, x, y, z)
```
