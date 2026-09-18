# buckets: the subset the generator already emits — a control fixture
import time

count = 0

while True:
    count = count + 1
    print(count)
    time.sleep(1)
