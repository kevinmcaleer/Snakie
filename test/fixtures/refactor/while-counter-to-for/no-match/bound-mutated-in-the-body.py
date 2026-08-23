"""The `while` re-reads the bound every pass; the body winds it down."""


class Queue:
    def drain(self):
        i = 0
        while i < self.pending:
            self.handle(i)
            self.pending = self.pending - 1
            i += 1
