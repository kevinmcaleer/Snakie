# Classroom Chrome policy: zero-prompt Pico/ESP32 access (#283)

Part of Snakie for Web (epic #267), Phase W2 ("real hardware over Web
Serial"). This is the recipe referenced by the epic's "killer classroom
feature": pre-granting a whole school fleet of managed Chromebooks silent
access to Pico/ESP32 boards over USB, so students **never see a permission
prompt** the first time they plug in a board.

## Why this is needed

Web Serial (`navigator.serial`) is gated by Chromium's permission model: the
first time a page calls `requestPort()`, the browser shows a picker dialog
and the user must explicitly choose a device. That's the right default for
the open web, but it's friction a classroom doesn't want repeated for every
student, every session, on every machine.

Chrome Enterprise has a policy for exactly this:
[`SerialAllowUsbDevicesForUrls`](https://chromeenterprise.google/policies/?policy=SerialAllowUsbDevicesForUrls)
— an admin-managed allowlist of `{ USB device(s), origin(s) }` pairs. Any
device matching an entry is **silently granted** to the matching origin(s):
`navigator.serial.getPorts()` returns it immediately, with no
`requestPort()` prompt ever needed. This policy is only available on
**managed** ChromeOS devices / Chrome browsers enrolled in an organization
(school-fleet Chromebooks are the target — see epic #267's "why web, not
Android" rationale).

Snakie's port picker (`src/web/portPicker.ts`) already does the right thing
without any classroom-specific code: `getGrantedPorts()` (backed by
`navigator.serial.getPorts()`) is tried first on connect, and only falls back
to the interactive `requestSnakiePort()` picker if it comes back empty. A
device pre-granted by this policy is picked up by that fast path for free.

## The VID/PID allowlist

The same identifiers Snakie's port picker filters on
(`src/shared/usb-bridges.ts`) — reused here so the admin's policy and the
app's own filters never drift apart. `SerialAllowUsbDevicesForUrls` uses
**decimal** vendor/product ids (not the `0x`-hex strings used elsewhere in
Snakie), so this table gives both:

| Board / chip                              | vendor_id (hex) | vendor_id (dec) | product_id (hex) | product_id (dec) |
| ------------------------------------------ | ---------------- | ---------------- | ------------------ | ------------------ |
| Raspberry Pi Pico / Pico 2 / Pico W (native USB, MicroPython running) | `0x2e8a` | 11914 | `0x0005` | 5 |
| Any other RP2040/RP2350 board (native USB) | `0x2e8a` | 11914 | *(any — omit product_id)* | — |
| Silicon Labs CP210x bridge (common ESP32 dev boards) | `0x10c4` | 4292 | `0xea60` | 60000 |
| WCH CH340 bridge (cheaper ESP8266/ESP32 boards) | `0x1a86` | 6790 | `0x7523` | 29987 |
| WCH CH341 bridge | `0x1a86` | 6790 | `0x5523` | 21795 |
| FTDI FT232R bridge (older ESP dev boards) | `0x0403` | 1027 | `0x6001` | 24577 |
| Espressif native USB (ESP32-S2/S3/C3 built-in USB) | `0x303a` | 12346 | *(any — omit product_id)* | — |

Omitting `product_id` matches **any** device from that vendor — useful for
`0x2e8a` (Raspberry Pi Foundation) and `0x303a` (Espressif), where the exact
product id varies by board revision. Adding a broad vendor-only entry is
usually the right classroom default (it also silently covers boards released
after this doc was written); narrow it to specific `vendor_id`/`product_id`
pairs if a school wants to be more restrictive.

## The policy JSON

`SerialAllowUsbDevicesForUrls` is a list of `{ devices, urls }` entries. Put
this in the policy's value (see "Applying it" below for *where*):

```json
[
  {
    "devices": [
      { "vendor_id": 11914, "product_id": 5 },
      { "vendor_id": 11914 },
      { "vendor_id": 4292, "product_id": 60000 },
      { "vendor_id": 6790, "product_id": 29987 },
      { "vendor_id": 6790, "product_id": 21795 },
      { "vendor_id": 1027, "product_id": 24577 },
      { "vendor_id": 12346 }
    ],
    "urls": ["https://app.snakie.org"]
  }
]
```

Notes on the schema (validated by Chromium — see
`chrome/browser/policy/serial_allow_usb_devices_for_urls_policy_handler_unittest.cc`
in the Chromium source for the exact rules):
- Every entry needs both `devices` (a non-empty list) and `urls` (a non-empty
  list) — a `devices`-only or `urls`-only entry is rejected.
- Each device needs at least `vendor_id`; `product_id` is optional and, if
  present, requires `vendor_id` to also be present.
- `urls` are matched as **origins** — use the scheme + host Snakie for Web is
  actually served from (see issue #286 for the `app.snakie.org` hosting
  decision). Add `http://localhost:PORT` too if IT wants to pre-grant a local
  dev/staging build.
- IDs are **decimal**, not the hex strings used in Snakie's own source and
  UI — double-check the table above if extending this list.

## Applying it (Google Admin console)

For a G Suite/Google Workspace-managed Chromebook fleet:

1. Go to **admin.google.com** → **Devices** → **Chrome** → **Settings**.
2. Pick the **organizational unit** (OU) to scope this to — e.g. a specific
   school, grade, or "STEM Lab Chromebooks" OU. Policies set at a narrower OU
   override a broader one, so you can pilot on one classroom's OU first.
3. Search settings for **"Serial devices"** / **Allow USB devices to connect
   to specified sites** (the console's human-readable name for
   `SerialAllowUsbDevicesForUrls`, under **User & browser settings** — it's
   also settable as a **Device** setting for kiosk/managed-guest sessions).
4. Paste the JSON from above into the policy's value field.
5. **Save**. Propagation to enrolled devices typically happens within
   minutes to a few hours (ChromeOS policy refresh interval), or immediately
   after the next sign-in / `chrome://policy` → **Reload policies**.

For Windows/macOS/Linux Chrome managed via a different MDM (e.g. Microsoft
Intune, Jamf), the same policy key
(`SerialAllowUsbDevicesForUrls`) is set via that MDM's Chrome ADMX/plist
template — the JSON payload is identical, only the delivery mechanism
differs.

## Verifying it worked

- On the managed device, visit **`chrome://policy`** and confirm
  `SerialAllowUsbDevicesForUrls` shows **Status: OK** with the expected JSON
  under "Policy value". If it's missing, the device may not have refreshed
  policy yet (use the **Reload policies** button on that page) or isn't in
  the OU the policy was applied to.
- Open Snakie for Web (`https://app.snakie.org`) with a Pico or ESP32 already
  plugged in — the app should connect **without ever showing the browser's
  "Select a device to connect" picker dialog**. If the picker still appears,
  the policy either hasn't propagated yet or the board's actual VID/PID
  isn't covered by the allowlist (unplug it, check `chrome://device-log` or
  the OS's USB device list for its real vendor/product id, and add it).
- This policy only affects **managed** browser profiles/devices. Testing on
  an unmanaged personal Chrome install will always show the picker — that's
  expected, not a bug.

## Related

- Epic #267 (Snakie for Web) — the "why web, not Android" rationale and the
  full phase breakdown this classroom feature sits in.
- Issue #283 (this issue) — the Web Serial transport + port picker
  (`src/web/webSerialTransport.ts`, `src/web/portPicker.ts`) that this policy
  makes prompt-free.
- Issue #286 — the `app.snakie.org` hosting decision (the exact origin to put
  in `urls` may change before launch; update this doc if it does).
