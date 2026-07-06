Work with files on your computer and on the board, side by side.

## Two trees

The **Files** view (activity bar) stacks two panes:

- **Local files** — a folder on your computer. Open one with the folder button;
  the breadcrumb re-roots the tree to any ancestor. Right-click for New File /
  New Folder / Rename / Delete / **Upload to board**.
- **Device files** — the connected board's filesystem. Click a file to open it
  (its editor tab shows in `[brackets]` so you can tell it apart from local
  files). Right-click to rename, delete, or **Download to computer**.
  Multi-select and drag-into-folder work here too, and the gauge at the top
  shows the board's flash usage.

Between the panes sits the **transfer bridge**: ↓ uploads the active editor
file to the board, ↑ saves the active device file to a local folder.

## Keep files in sync

Editing locally but running on the board? Stop re-uploading by hand:

1. **Hover a local file** and **tick its checkbox** — the file is now tagged
   for sync (it shows a green **⇄** at rest; hover to untick).
2. Turn on the **sync toggle** in the Device files toolbar. That pushes every
   tagged file to the board immediately **and** re-pushes each one whenever you
   save it. The icon spins while syncing and shows a green tick when done.

Each tagged file lands at `/<filename>` on the board. Tags and the toggle
survive restarts. Click the toggle again to stop auto-syncing.

## No board handy?

Connect to the **Simulated device (offline)** in the port dropdown — it has a
real (in-memory) filesystem, so uploads, downloads and sync all work exactly
the same. It resets when you disconnect.
