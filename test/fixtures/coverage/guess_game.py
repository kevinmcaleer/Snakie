# buckets: while/break, comparison, print, input, trailing comment
import random

secret = random.randint(1, 100)
tries = 0

while True:
    guess = int(input("guess: "))
    tries += 1
    if guess == secret:
        print("got it")
        break
    if guess < secret:
        print("higher")  # too low
    else:
        print("lower")

print(tries)
