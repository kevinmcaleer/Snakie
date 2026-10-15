#!/usr/bin/env python3
"""Rendered light/dark contrast audit for Snakie.

Opens the web build (``npm run dev:web``) in headless Chromium, visits each screen
in BOTH themes, screenshots it, and runs ``contrast-probe.js`` to score every
visible piece of text against the background actually painted behind it.

Usage:
    npm run dev:web -- --port 5199 --strictPort      # in another terminal
    python3 scripts/design/rendered-contrast.py [--url http://localhost:5199/] [--out docs/design/audit]

Writes <out>/rendered-contrast.json, <out>/screens/<screen>-<theme>.png (git-ignored)
and <out>/screens/<screen>.jpg (light | dark side by side, committed).
Requires: pip install playwright && python -m playwright install chromium
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path

from PIL import Image
from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
PROBE = (HERE / "contrast-probe.js").read_text()
THEMES = {"light": "skeuomorph", "dark": "dark"}


def click(page: Page, *names: str) -> None:
    """Click the first visible control whose accessible name or title starts with one of `names`."""
    for name in names:
        loc = page.locator(f'[aria-label^="{name}"], [title^="{name}"]').filter(visible=True)
        if loc.count():
            loc.first.click()
            page.wait_for_timeout(900)
            return
        loc = page.get_by_role("button", name=name).filter(visible=True)
        if loc.count():
            loc.first.click()
            page.wait_for_timeout(900)
            return
    raise RuntimeError(f"no control named {names}")


def press_escape(page: Page) -> None:
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


# Each screen: (id, label, setup). setup runs on a freshly loaded page.
SCREENS = [
    ("code", "Code workspace", lambda p: click(p, "Editor-first")),
    ("blocks", "Blocks workspace", lambda p: click(p, "Blocks-first")),
    ("split", "Blocks + Python split", lambda p: click(p, "Blocks and Python")),
    ("electronics", "Electronics (Board View)", lambda p: click(p, "Wire components")),
    ("build", "Build (3D robot)", lambda p: click(p, "Assemble the robot")),
    ("packages", "Packages panel", lambda p: click(p, "Packages")),
    ("inspect", "Inspect panel", lambda p: click(p, "Inspect")),
    ("learn", "Learn panel", lambda p: click(p, "Learn")),
    ("help", "Help", lambda p: click(p, "Help")),
    ("report", "Report bug", lambda p: click(p, "Report Bug")),
    ("settings", "Settings dialog", lambda p: click(p, "Settings")),
    ("flash", "Flash firmware", lambda p: click(p, "Flash MicroPython", "Flash firmware")),
    ("schematic", "Electronics schematic", lambda p: (click(p, "Wire components"), p.locator(".boardgraph__viewtab", has_text="Schematic").first.click())),
    ("partedit", "Part editor (new part)", lambda p: (click(p, "Wire components"), p.get_by_role("button", name=re.compile("New part")).first.click())),
    (
        "instruments",
        "Instruments (multimeter, servo, oscilloscope)",
        lambda p: (click(p, "Show Multimeter"), click(p, "Show Servo"), click(p, "Show Oscilloscope")),
    ),
]


HIDE_TEXT = """
* { color: transparent !important; -webkit-text-fill-color: transparent !important;
    text-shadow: none !important; caret-color: transparent !important; }
svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }
"""


def _lin(v: float) -> float:
    v /= 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def _lum(c) -> float:
    return 0.2126 * _lin(c[0]) + 0.7152 * _lin(c[1]) + 0.0722 * _lin(c[2])


def _ratio(a, b) -> float:
    x, y = sorted([_lum(a), _lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


def _hex(h: str):
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def score_against_pixels(records: list, bg_png: Path) -> None:
    """Re-score each record against the pixels actually painted behind its text.

    The DOM probe's background is a best guess (stacking + gradient stops); this
    replaces it with the median of the real background pixels inside the text's
    box, captured with all text made transparent. `ratio_px_worst` uses the
    background pixel closest in luminance to the text (10th percentile of the
    contrast distribution) so a gradient or texture behind text is not averaged away.
    """
    img = Image.open(bg_png).convert("RGB")
    W, H = img.size
    for r in records:
        x, y, w, h = r["rect"]
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(W, x + w), min(H, y + h)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        px = list(img.crop((x0, y0, x1, y1)).get_flattened_data())
        if len(px) > 4000:
            px = px[:: len(px) // 4000]
        med = tuple(int(statistics.median(c[i] for c in px)) for i in range(3))
        fg = _hex(r["fg"]) if r["fg"].startswith("#") else None
        if not fg:
            continue
        ratios = sorted(_ratio(fg, c) for c in px)
        r["bg_px"] = "#%02x%02x%02x" % med
        r["ratio_px"] = round(_ratio(fg, med), 2)
        r["ratio_px_worst"] = round(ratios[len(ratios) // 10], 2)


def pair(folder: Path, sid: str) -> None:
    """Write <sid>.jpg: light on the left, dark on the right, for side-by-side review."""
    a, b = folder / f"{sid}-light.png", folder / f"{sid}-dark.png"
    if not (a.exists() and b.exists()):
        return
    la, lb = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    w, h = la.size
    both = Image.new("RGB", (w * 2 + 8, h), "white")
    both.paste(la, (0, 0))
    both.paste(lb, (w + 8, 0))
    both = both.resize((both.width * 3 // 4, h * 3 // 4))
    both.save(folder / f"{sid}.jpg", quality=72, optimize=True)


def load(page: Page, url: str, theme: str) -> None:
    page.goto(url)
    page.evaluate(f"localStorage.setItem('snakie.theme.v2', JSON.stringify('{theme}'))")
    page.reload()
    page.wait_for_timeout(3500)
    got = page.get_by_role("button", name="Got it").filter(visible=True)
    if got.count():
        got.first.click()
        page.wait_for_timeout(300)


def _component(key: str) -> str:
    path = key.split(" :: ")[0].split(" > ")
    return next((p.split(".")[1] for p in reversed(path) if "." in p), path[-1])


def summarise(report: dict) -> dict:
    """Roll records up into the parity numbers the audit reports.

    An element is matched across themes by its key (class path + text). It FAILS
    when its pixel-measured ratio is under the WCAG threshold for its size.
    """
    best: dict = {"light": {}, "dark": {}}
    for s in report["screens"]:
        for t, v in s["themes"].items():
            for r in v.get("records", []):
                if r.get("disabled") or "ratio_px" not in r:
                    continue
                cur = best[t].get(r["key"])
                if cur is None or r["ratio_px"] < cur[0]["ratio_px"]:
                    best[t][r["key"]] = (r, s["id"])
    fails = {t: {k: v for k, v in best[t].items() if v[0]["ratio_px"] < v[0]["need"]} for t in best}
    common = set(best["light"]) & set(best["dark"])
    light_worse = sum(1 for k in common if best["light"][k][0]["ratio_px"] < best["dark"][k][0]["ratio_px"])

    def rows(keys: set, theme: str) -> list:
        other = "dark" if theme == "light" else "light"
        groups: dict = {}
        for k in keys:
            r, sid = fails[theme][k]
            groups.setdefault(_component(k), []).append((r, sid, k))
        out = []
        for comp, items in groups.items():
            r, sid, k = min(items, key=lambda x: x[0]["ratio_px"])
            o = best[other].get(k)
            out.append({"component": comp, "count": len(items), "screen": sid, "text": r["text"][:40], "fg": r["fg"],
                        "bg": r["bg_px"], "ratio": r["ratio_px"], "need": r["need"],
                        "otherTheme": o[0]["ratio_px"] if o else None})
        return sorted(out, key=lambda x: x["ratio"])

    def hexrgb(h: str):
        return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))

    invariant: dict = {}
    for k in common:
        a, b = best["light"][k][0], best["dark"][k][0]
        if a["fg"] == b["fg"] and max(abs(x - y) for x, y in zip(hexrgb(a["bg_px"]), hexrgb(b["bg_px"]))) <= 6:
            root = next((p.split(".")[1] for p in k.split(" :: ")[0].split(" > ") if "." in p), "")
            invariant.setdefault(root, []).append(_component(k))

    fl, fd = set(fails["light"]), set(fails["dark"])
    return {
        "elements": {t: len(best[t]) for t in best},
        "failing": {t: len(fails[t]) for t in fails},
        "severe": {t: sum(1 for v in fails[t].values() if v[0]["ratio_px"] < 3) for t in fails},
        "medianRatio": {t: round(statistics.median(best[t][k][0]["ratio_px"] for k in common), 2) for t in best},
        "lightWorse": light_worse,
        "compared": len(common),
        "failBoth": rows(fl & fd, "light"),
        "failLightOnly": rows(fl - fd, "light"),
        "failDarkOnly": rows(fd - fl, "dark"),
        "themeInvariant": {k: sorted(set(v)) for k, v in sorted(invariant.items(), key=lambda x: -len(x[1]))},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5199/")
    ap.add_argument("--out", default="docs/design/audit")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--summarise", action="store_true", help="re-summarise an existing rendered-contrast.json without re-running")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "screens").mkdir(parents=True, exist_ok=True)
    if args.summarise:
        report = json.loads((out / "rendered-contrast.json").read_text())
        report["summary"] = summarise(report)
        (out / "rendered-contrast.json").write_text(json.dumps(report, separators=(",", ":")))
        print(json.dumps({k: v for k, v in report["summary"].items() if not isinstance(v, (list, dict)) or k in ("failing", "elements", "medianRatio", "severe")}))
        return

    report: dict = {"screens": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for sid, label, setup in SCREENS:
            if args.only and sid not in args.only:
                continue
            entry = {"id": sid, "label": label, "themes": {}}
            for tname, tval in THEMES.items():
                page = browser.new_page(viewport={"width": 1440, "height": 900})
                load(page, args.url, tval)
                try:
                    setup(page)
                    page.wait_for_timeout(1200)
                    shot = out / "screens" / f"{sid}-{tname}.png"
                    page.screenshot(path=str(shot))
                    records = page.evaluate(PROBE)
                    page.add_style_tag(content=HIDE_TEXT)
                    page.wait_for_timeout(300)
                    bg = out / "screens" / f".{sid}-{tname}-bg.png"
                    page.screenshot(path=str(bg))
                    score_against_pixels(records, bg)
                    bg.unlink()
                    entry["themes"][tname] = {"screenshot": str(shot), "records": records}
                except Exception as exc:  # keep going; report what failed
                    entry["themes"][tname] = {"error": str(exc)[:300]}
                page.close()
            pair(out / "screens", sid)
            report["screens"].append(entry)
            ok = {t: len(v.get("records", [])) for t, v in entry["themes"].items()}
            print(f"{sid:12} {ok}")
        browser.close()
    report["summary"] = summarise(report)
    (out / "rendered-contrast.json").write_text(json.dumps(report, separators=(",", ":")))
    sm = report["summary"]
    print(f"failing text: light {sm['failing']['light']} / dark {sm['failing']['dark']} "
          f"(of {sm['elements']['light']} / {sm['elements']['dark']}); median ratio light {sm['medianRatio']['light']} dark {sm['medianRatio']['dark']}")
    print(f"wrote {out / 'rendered-contrast.json'}")


if __name__ == "__main__":
    main()
