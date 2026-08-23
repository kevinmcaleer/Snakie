def drain(queue):
    while queue:
        if queue.peek(): queue.pop(); queue.ack()
