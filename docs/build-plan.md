# Snakie — First Build Plan

This document breaks the [epic](epic.md) down into a deliverable **first build
(v0.1.0)** plus a backlog of follow-on work.

## Goal of the first build

Deliver a usable MicroPython editor that can:

1. Edit one or more Python files in a clean, tabbed interface.
2. Browse the local file system.
3. Connect to a MicroPython device over serial.
4. Browse and manage files on the device.
5. Upload code to the device and run/stop it.
6. Drive the device through an interactive REPL/shell.
7. Be packaged and installed on Windows, macOS and Linux.

## Architecture overview

- **Main process (Electron):** window/lifecycle management, serial port access
  via `node-serialport`, native file dialogs, MicroPython raw-REPL protocol.
- **Renderer (Vite + React + TS):** editor, panels, shell UI. Talks to the main
  process over a typed IPC bridge (`contextBridge` / `preload`).
- **Device layer:** an abstraction implementing the MicroPython raw-REPL
  protocol (enter/exit raw mode, exec, soft reset, file read/write/list/remove)
  — conceptually the same as `mpremote` / `ampy`.

## First-build scope (v0.1.0)

| # | Task | Epic line(s) |
|---|------|--------------|
| 1 | Project scaffold: Electron + Vite + React + TS, dev/build scripts | 2,3 |
| 2 | App shell layout: resizable, collapsible panels; uncluttered theme | 11,12 |
| 3 | Monaco editor integration with Python/MicroPython syntax | 5 |
| 4 | Tabbed editor for multiple open files | 18 |
| 5 | Local file browser side panel (open/create/rename/delete) | 13 |
| 6 | Serial device connection layer (detect/connect/disconnect) | 8 |
| 7 | Device file browser panel (list files on device) | 13 |
| 8 | Device file operations: create folder, rename, delete | 14 |
| 9 | Upload current file to the connected device | 8 |
| 10 | Interactive REPL/shell window | 15 |
| 11 | Run / Stop / Clear Shell controls | 16,17 |
| 12 | Packaging & CI: electron-builder for Win/Mac/Linux | 2,3 |

## Backlog (post-v0.1.0)

These epic features are intentionally deferred so the first build stays focused:

- Auto-complete / IntelliSense (line 6)
- Flash MicroPython firmware to device (line 9)
- Built-in version control, VS Code-style (line 10)
- Variables & code-outline panels (line 12)
- Update notifications for new versions (line 4)
- Integrated LLM chat pane (line 7)
