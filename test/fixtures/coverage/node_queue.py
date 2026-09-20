# buckets: two classes in one file, obj.x attribute get/set, None checks
class Node:
    def __init__(self, value):
        self.value = value
        self.next = None


class Queue:
    def __init__(self):
        self.head = None
        self.size = 0

    def push(self, value):
        node = Node(value)
        if self.head is None:
            self.head = node
        else:
            tail = self.head
            while tail.next is not None:
                tail = tail.next
            tail.next = node
        self.size = self.size + 1

    def pop(self):
        node = self.head
        if node is None:
            return None
        self.head = node.next
        self.size = self.size - 1
        return node.value


jobs = Queue()
jobs.push("scan")
jobs.push("report")
print(jobs.pop(), jobs.size)
