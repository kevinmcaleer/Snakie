- **A robot frame for web pages, moved by the code (#1321).**
  `<div data-snakie-robot="<kevsrobots project id>">` (or
  `/embed.html?robot=1&project=<id>`) draws the URDF and meshes a project
  carries among its files. Press Run in a code frame on the same page and the
  joints the project binds to servo pins turn with the PWM the code sends.
  Joint sliders move it by hand, and `urdf=` draws a URDF from any https
  address.
