def wrap_angle(angle, limit):
    """Returns None when the angle was already in range — `-> int` would say 0."""
    while angle > limit:
        angle = angle - limit
    if angle < 0:
        return angle + limit
