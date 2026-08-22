def drain(queue):
    while queue:
        handle(queue.pop())
