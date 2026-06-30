#!/usr/bin/env bash
#
# install-linux-menu.sh — add Snakie to the application menu (issue: Raspberry Pi
# build / menu integration).
#
# An AppImage is a single self-contained file and does NOT register itself in the
# desktop menu. This script installs a per-user desktop entry + icon pointing at
# the Snakie AppImage, so it appears in the menu — on Raspberry Pi OS that's the
# "Programming" section, because the entry's `Categories=Development` is what the
# Pi menu maps there.
#
# Usage:
#   ./install-linux-menu.sh [path/to/Snakie-<version>-arm64.AppImage]
#
# With no argument it looks for a single Snakie-*.AppImage next to this script,
# in the current directory, or in ~/Downloads. Re-run it after downloading a new
# version to point the menu entry at the new file. Run `--uninstall` to remove it.
set -euo pipefail

APP_NAME="Snakie"
DESKTOP_ID="snakie"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons"
DESKTOP_FILE="$APPS_DIR/$DESKTOP_ID.desktop"
ICON_FILE="$ICON_DIR/$DESKTOP_ID.png"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$DESKTOP_FILE" "$ICON_FILE"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true
  echo "Removed Snakie from the application menu."
  exit 0
fi

# --- Locate the AppImage ----------------------------------------------------
find_appimage() {
  if [ -n "${1:-}" ]; then printf '%s\n' "$1"; return; fi
  local here; here="$(cd "$(dirname "$0")" && pwd)"
  local candidates=()
  for dir in "$here" "$PWD" "$HOME/Downloads"; do
    for f in "$dir"/Snakie-*.AppImage; do
      [ -f "$f" ] && candidates+=("$f")
    done
  done
  if [ "${#candidates[@]}" -eq 0 ]; then
    echo "error: no Snakie-*.AppImage found. Pass its path:" >&2
    echo "  $0 ~/Downloads/Snakie-<version>-arm64.AppImage" >&2
    exit 1
  fi
  # Newest by name (versions sort lexically well enough for v0.x).
  printf '%s\n' "${candidates[@]}" | sort | tail -1
}

APPIMAGE="$(find_appimage "${1:-}")"
if [ ! -f "$APPIMAGE" ]; then
  echo "error: AppImage not found: $APPIMAGE" >&2
  exit 1
fi
# Absolute path so the menu entry works regardless of the working directory.
APPIMAGE="$(cd "$(dirname "$APPIMAGE")" && pwd)/$(basename "$APPIMAGE")"
chmod +x "$APPIMAGE"
echo "Using AppImage: $APPIMAGE"

mkdir -p "$APPS_DIR" "$ICON_DIR"

# --- Extract the icon from the AppImage -------------------------------------
# The AppImage embeds the icon; pull it out so the menu entry has a real icon.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if ( cd "$tmp" && "$APPIMAGE" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1 ); then
  icon_src="$(find "$tmp/squashfs-root" -name '*.png' 2>/dev/null | sort | tail -1)"
  if [ -n "$icon_src" ]; then
    cp "$icon_src" "$ICON_FILE"
    echo "Installed icon: $ICON_FILE"
  fi
fi
# Fall back to the named theme icon if extraction failed.
[ -f "$ICON_FILE" ] && ICON_VALUE="$ICON_FILE" || ICON_VALUE="$DESKTOP_ID"

# --- Write the desktop entry ------------------------------------------------
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
GenericName=MicroPython Editor
Comment=A modern, cross-platform MicroPython editor
Exec="$APPIMAGE" --no-sandbox %U
Icon=$ICON_VALUE
Terminal=false
Categories=Development;
Keywords=MicroPython;Python;Editor;Pico;microcontroller;Raspberry Pi;
StartupWMClass=$APP_NAME
EOF
chmod +x "$DESKTOP_FILE"
echo "Installed menu entry: $DESKTOP_FILE"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true

echo
echo "Done — Snakie should now appear in the menu under Programming."
echo "(If it doesn't show immediately, log out/in or restart the panel.)"
