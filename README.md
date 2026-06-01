# Snakie

A modern, cross-platform **MicroPython editor**.

Snakie is a clean, uncluttered IDE for writing MicroPython code and working with
connected MicroPython devices. It is built on Electron so it runs on Windows,
macOS and Linux, and updates easily.

## Vision

- ✏️ Edit MicroPython code with syntax highlighting and auto-complete
- 🔌 Connect to a MicroPython device over serial
- 📤 Upload code to the connected device
- 🐚 Interactive shell (REPL) for live coding
- ▶️ Run & Stop buttons, with a one-click Clear Shell
- 🗂️ Browse files both locally and on the device (Thonny-style)
- 📁 Create / rename / delete files and folders on the device
- 🧩 Tabbed interface for editing multiple files at once
- 📦 Flash MicroPython firmware to a device
- 🔭 Variables and code-outline panels (collapsible)
- 🌳 Built-in version control (Git, VS Code-style)
- 🤖 Integrated LLM chat pane
- 🔔 Update notifications when a new version is ready

## Tech stack

- **Electron** — cross-platform desktop shell
- **Vite + React + TypeScript** — renderer UI
- **Monaco Editor** — code editing
- **node-serialport** — device communication (MicroPython raw-REPL protocol)
- **electron-builder** — packaging for Windows / macOS / Linux

## Status

🚧 Early development — see [docs/build-plan.md](docs/build-plan.md) for the
first-build plan and the [issues](../../issues) for tracked work.

## License

MIT
