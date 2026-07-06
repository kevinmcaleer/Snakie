Keep your project's history with the built-in Source Control panel.

## Point it at your project

Open **Source Control** in the activity bar. It follows your working folder
(the one open in Local files). If the folder isn't a Git repository yet, use
**Init** to create one.

## The everyday loop

1. Edit and save files — changes appear grouped as **Staged**, **Changes** and
   **Untracked**.
2. Click a file to see its **diff**; use **Stage** / **Unstage** to choose what
   goes into the commit (or let commit stage everything).
3. Type a **commit message** and hit **Commit** (it stages all changes and
   commits when nothing is staged yet).
4. **Push** and **Pull** sync with the remote; the **↑ / ↓ counts** show how
   many commits you're ahead/behind.

**Discard changes** on a file restores it to the last commit — handy when an
experiment goes sideways (that's rather the point of version control).

## Branches

The **branch dropdown** switches branches; pick an existing one or create a new
branch to try an idea without touching your working code.

## Tips

- The status bar shows a **⎇ changed-file count** for the working folder at a
  glance.
- Commit small and often — "got the servo sweeping" is a great commit message.
- Files on the **board** aren't versioned; keep your source local (use file
  sync to push it to the board) so Git sees every change.
