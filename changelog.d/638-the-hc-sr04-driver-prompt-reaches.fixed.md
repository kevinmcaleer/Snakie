- **The HC-SR04 driver prompt reaches installs that already had the typo'd
  duplicate (#638).** Pointing the standard `hc-sr04` part at its `hcsr04`
  driver only helped fresh installs. The seeder walks the parts the app ships,
  so `hr-sr04` — the typo'd copy of the same sensor, withdrawn from the bundle —
  stayed in every existing library forever, without the driver metadata, still
  offered in the catalog beside the real part. Withdrawn parts are now removed
  from the install (only copies the seeder wrote and nobody edited), and a
  project that already placed one resolves to the part that replaced it, so the
  "your board is missing `hcsr04`" notice and the Board View install banner
  finally fire.
