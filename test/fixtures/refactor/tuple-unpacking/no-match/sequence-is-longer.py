"""A fourth channel is read elsewhere, so unpacking three would raise."""


def channels(pixel):
    red = pixel[0]
    green = pixel[1]
    blue = pixel[2]
    print("alpha is", pixel[3])
    return red, green, blue
