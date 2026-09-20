- **Placing the HC-SR04 offers its driver (hcsr04) like every other sensor (#638).** 
  The standard HC-SR04 part declared no `library.module` and no `drivers`, so
  adding it to a project prompted nothing — no "your board is missing `hcsr04`"
  notice, and no install row in the Board View's driver banner — and running the
  code failed with a bare `ImportError: no module named 'hcsr04'`. It now points
  at the bundled `hcsr04` driver, the same way the Grove ultrasonic ranger does.
