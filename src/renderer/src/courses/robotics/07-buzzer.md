## Make some noise 🎵

A buzzer turns electricity into sound. By sending it different frequencies, one after another, you can play a little tune!

Here's what the starter code does:

- `Buzzer(PWM(Pin(16)))` connects a buzzer to pin 16. PWM is what lets the pin "wiggle" fast enough to make a note.
- The numbers `262, 330, 392, 523` are frequencies in hertz — that's how many wiggles per second. They spell out C, E, G, and high C.
- `buz.tone(note)` plays one note; `time.sleep_ms(250)` holds it for a quarter of a second before the next.
- `buz.off()` stops the sound at the end so it doesn't keep humming.

### Try it
1. Make sure the simulated device is **connected** (it auto-connects).
2. Press **Run ▶** and listen — four notes climb up like a doorbell.
3. Open the **Board View** and find pin 16 to see where the buzzer is wired.

### Now you
Change the loop to `(523, 392, 330, 262)` so the notes climb **down** instead of up. Can you add two more numbers to make it longer?

> Higher number = higher pitch. A melody is just the right numbers in the right order.
