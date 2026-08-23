"""`self` is a convention, not a keyword — the receiver is the first parameter.

Both methods here take five values from the caller, exactly like
`at-the-threshold.py`, but neither names its receiver `self`. Counting by name
would find six parameters and underline the instance itself as something to
bundle into an object.
"""


class Arm:
    def reach(s, shoulder, elbow, wrist, grip, speed):
        s.shoulder.angle(shoulder)
        s.elbow.angle(elbow)
        s.wrist.angle(wrist)
        s.grip.angle(grip)
        s.speed = speed

    @classmethod
    def parked(klass, shoulder, elbow, wrist, grip, speed):
        arm = klass()
        arm.reach(shoulder, elbow, wrist, grip, speed)
        return arm
