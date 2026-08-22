"""A handler can see the half-built string, so the two versions differ."""


def read_all(port):
    try:
        data = ""
        for chunk in port:
            data += chunk
    except OSError:
        print("link dropped; keeping whatever arrived")
    return data
