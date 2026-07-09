# Changelog

All notable changes to Snakie are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Robot View — Join tool: SHIFT-lock snapping + an on-surface target (#354).**
  While picking a joint point, an accurate **target** is drawn on the surface (a
  circle + X/Y/Z axis triad; a **cross-hair** over a hole / loop centre) so you can
  see exactly where it will land. Sliding the cursor onto a hole used to lose the
  snap (there's no surface at the centre to hover) — now **hold Shift** to lock the
  snaps in place and click the hole centre.
- **Robot View — rotation joints get min/max + a default angle (#354).** When you
  choose **Rotation** in the Add Joint dialog, min / max angle limits and a default
  angle (degrees) appear; **Add** writes the joint's `<limit>` and saves the default
  to the robot's default pose. The joint is then movable — drag it in the pose
  panel to preview the swing, and it loads at the default angle.
- **Robot View — Join tool fades the first-picked block (#354).** After you pick a
  point on the first block, that block goes semi-transparent (Fusion-style) so it's
  obviously chosen — and can't be picked as the second component. It restores when
  the joint is added or cancelled.
- **Robot View — Join tool mates faces by their normals + on-face markers (#354).**
  Picking a point now captures the **face normal**, drawn as a **circle laid flat on
  the face** with an **X/Y/Z axis triad** (blue = parent, green = child) — it sits in
  3-D on the surface instead of facing the camera, so it reads accurately from any
  angle. The joint is oriented from those **local** face normals: the child rotates
  so its face meets the parent's flush (its normal anti-parallel to the parent's) and
  the two picked points coincide.
- **Robot View — delete a joint (#354).** Clicking a joint in the **Joints** branch
  already opened its editor (type / axis / limits); it now also has a **Delete**
  button that removes the joint and re-attaches the block to the base, keeping its
  current position so it doesn't jump.
- **Robot View — Join tool: smart parent/child + multi-joint chains (#354).** You
  no longer have to pick the two blocks in the "right" order — if the chosen order
  would form a loop but the reverse wouldn't, the tool **swaps** parent and child
  for you. Building a chain of joints works (each new joint keeps the earlier ones);
  note that a joined child snaps to meet its parent, so it visibly moves.
- **Robot View — Join tool snaps to hole centres (#354).** When you pick a joint
  point on an imported mesh (STL), the tool detects **hole centres** on the clicked
  face — an STL is just triangles, so it finds the coplanar rim-edge loops, and a
  roughly-circular loop's centre becomes a snap point (plus the face outline centre
  and midpoints of long edges as alignment guides). Hover reveals the snaps.
- **Robot View — Join tool (#354).** A new **Add Joint** button on the build
  toolbar opens a floating dialog, then you **click a point on each block in 3-D**
  to connect them: Component 1 (parent) then Component 2 (child), each snapping to a
  face corner / edge / centre. Choose the joint type (**Static / Rotation / Linear**)
  and an optional X/Y/Z offset, then **Add** — the child snaps so its picked point
  meets the parent's, is re-parented under it, and the new joint appears in the
  **Joints** branch. Refuses a connection that would form a loop.
- **Robot View — open a different robot (.urdf).** The docked mini viewer gains an
  **📂 Open…** button (alongside New robot / Pop out) and the pose tool's Build
  panel gains one too, so you can pick and open another robot model via the native
  file dialog — including when the view is popped out full-screen.
- **Robot View — hierarchy is now a node tree with context dialogs (#353).** The
  Build panel groups the model into collapsible branches — **Blocks**, **Meshes**,
  **Joints**, **Servos** and **Poses** — each with a count. Clicking a node opens
  a Fusion-style floating dialog on the right tailored to it: a **joint** shows its
  type/axis/limits/mimic; a **servo** shows its joint mapping, servo/joint ranges,
  invert and a delete; a **pose** shows rename, **Recall** and delete; a
  **block/mesh** (edit pencil) shows size + joint. Block/joint edits apply live and
  **Cancel** reverts them; servo/pose edits are held until **OK**.
- **Robot View — Fusion-style Properties dialog (#352).** Clicking a block's
  **edit pencil** now opens a floating, **draggable** properties dialog on the
  right (size + joint) instead of expanding the hierarchy row. Edits apply live to
  the 3-D preview; **OK** keeps them, **Cancel** discards them (the URDF is
  snapshotted on open and restored on cancel) — both close the dialog. Delete
  moved onto the hierarchy row.
- **Robot View — animated camera moves.** Clicking a nav-cube face/edge/corner,
  focusing a block from the hierarchy, **Home** and **Fit** now **glide** the
  camera to the destination (eased ~0.3s) instead of jumping, so you can see where
  the view came from and went to. Grabbing the viewport cancels the glide. The
  zoom **%** now also tracks scroll-zoom in **perspective** mode (dolly distance),
  and focusing one block no longer clips the others.
- **Robot View — themed background + a richer navigation cube.** The 3-D viewer
  background now follows the theme (**white** in light, **black** in dark). The
  ViewCube is **brass**, always drawn in **perspective** (independent of the view's
  projection), sits tight in the top-right, shows **X/Y/Z axes** (red/green/blue
  with labels) along its base, and uses a pointer cursor so corner picks aren't
  hidden by the hand cursor.
- **Robot View — orthographic / perspective toggle.** A dropdown beneath the
  navigation cube switches the camera between **Orthographic** (default, no
  distortion — best for building) and **Perspective** (a natural, lens-like view).
  Switching re-frames the model; zoom / orbit / snap all work in both.
- **Robot View — undo / redo for builder actions (#338).** Every builder edit
  (add / push-pull / move / delete / joint change / mesh import / re-root) is now
  an undo step: **⌘Z / Ctrl+Z** to undo, **⇧⌘Z / Ctrl+Y** to redo, plus undo/redo
  buttons on the build toolbar. A drag is a single step; undoing a delete restores
  the block + its sub-tree; the camera doesn't jump. (History is per-file.)
- **Robot View — timeline: duplicate keyframes + mirror-invert toggle (#332).**
  The motion timeline gains a **⧉ Duplicate** control (copies the selected
  keyframe — or the whole pose at the playhead — to a free slot, growing the clip
  if it lands past the end, never overwriting an existing key), and a per-pair
  **mirror-invert** checkbox so a reversed-axis left↔right joint mirrors correctly
  in one click (persists to `robot.yml`).
- **Robot View — navigation cube.** A large CAD-style **ViewCube** at the
  top-right of the 3-D viewer, mirroring the camera as you orbit and lit from the
  lower-front so it reads as a solid block. **Click a face, edge or corner** (26
  orientations) to snap the view, **drag the cube** to orbit, and the region under
  the pointer highlights with a brass overlay (a plate on a face, a bar on an edge,
  a cube on a corner). A **Home** button (revealed on hover) resets to the default
  isometric view. Runs in its own canvas so it never fights the viewer's orbit/zoom.
- **Robot View — new blocks & meshes arrive at the origin, not stuck to the
  selection.** Adding a block or importing an STL/DAE now drops it at the
  **workspace origin** (attached to the base), **selects it**, and **reframes** so
  it's actually in view — instead of auto-joining it to the selected part with an
  offset (a placement that can't be guessed). Selecting a block in the Build list
  highlights it in 3-D, meshes included (re-applied once an async mesh loads).
- **Robot View — zoom controls + a consistent pin.** The 3-D viewer gains the
  usual floating **zoom cluster** bottom-right (−, a live **%** readout, +, and a
  **zoom-to-fit** button), styled identically to the node-graph control;
  **double-click the %** toggles 100% ↔ fit. The Build panel's pin button now uses
  the app's standard **pushpin** icon (outline when loose, filled when pinned) and
  accent colour, instead of a one-off gold star.
- **Robot View — "Make base" + base protection (#309 builder).** A URDF hangs off
  its **base** link, so deleting the base used to leave an empty, unusable file.
  Now the base **can't be deleted** (its ✕ is disabled with a hint, and it shows a
  "★ This is the base" badge), and every other block gains a **★ Make base** button
  that re-roots the whole model onto it — reversing the joint chain up to the old
  base (origins inverted exactly, off-path sub-trees left untouched). So you can
  bless a new base mid-build and then delete the old one. Fixed joints re-root
  perfectly; a movable joint that happens to sit on the reversed path keeps its
  axis/limits (best effort).
- **Robot View — joint editor: hinges, sliders, wheels + mimic (#315, epic #309
  Phase 5).** Editing a block in the Build panel now also sets **how it moves**
  relative to its parent: pick **Fixed / Hinge / Slider / Wheel** (URDF
  fixed / revolute / prismatic / continuous), choose the **axis** (X / Y / Z) and
  set **limits** (degrees for a hinge, mm for a slider). A **Copies** dropdown
  makes the joint **mimic** another with a gear ratio (× multiplier + offset) —
  e.g. a gripper's two fingers, or a geared pair. Every change rewrites the URDF
  and shows up **live** in the pose tool and the motion timeline, so you can
  build a 2-link arm from blocks, make the elbow a hinge and pose it straight
  away. Completes the #315 builder scope (primitives + push/pull + move + joints).
- **Robot View — builder tools: a toolbar + move-with-snap (#335, epic #309
  Phase 5).** The block builder gains a floating **tool toolbar** (top-centre of
  the stage): **Pick** (select), **Push & pull** (resize a face), **Move** a
  block, and **Join** (coming soon). The new **Move** tool slides a block around
  with a live mm read-out and a 5 mm grid (hold **Shift** for 1 mm); hover a face
  and Fusion-style **snap handles** appear on its corners, edge-midpoints and
  centre, so you can drop a block with its face point landing exactly on another
  block's corner / edge / centre (the read-out shows **snap ✓**). Moves rewrite
  the block's fixed-joint origin in the linked URDF, and the camera never jumps.
- **Robot View — kid-friendly block builder (#315a, epic #309 Phase 5).** Build a
  robot from blocks: a floating, transparent, pinnable **Build** panel on the left
  (like the breadboard's library dock) lists your components with a per-item edit
  pencil (view by default). **＋ Box / Tube / Ball** adds a primitive that sticks
  to the selected part (a fixed joint — no jargon). Grab a **face and pull** to
  resize it — Fusion-style, with the **live measurement** shown and the opposite
  face held put — or type exact mm. Edits save straight into the linked project
  URDF, and the camera never jumps. (Revolute/prismatic joints + a mimic editor
  are the follow-up #315b.)
- **Robot View — motion timeline → MicroPython (#314, epic #309 Phase 4).** A
  keyframe timeline docks under the pose tool: a track per joint, **play / loop /
  scrub** with **linear or ease-in-out** easing, snapshot the pose as a keyframe
  or **import a saved pose**, and **mirror** a track onto its left↔right partner
  (**Mirror ½** offsets half a cycle — a walk). **Export .py** bakes the eased
  motion into runnable MicroPython that drives the servos from the servo↔joint
  map — the *same* clip plays in the simulator and on a board. Persists in
  `robot.yml` (`timeline` + `mirror`). Try `examples/biped/`. The generated code
  is proven runnable by an end-to-end test that executes it on the real
  MicroPython interpreter and checks the servo stream.
- **New blank robot (.urdf) from Robot mode.** The docked mini-viewer gains a
  **＋ New robot** button (highlighted when there's no robot yet) that creates a
  minimal starter `.urdf` (one `base_link`) and opens it in the pose tool — a
  real file in the project folder (so STL import + persistence work immediately),
  or an untitled buffer when no folder is open. Import meshes from the Assembly
  panel to build it up.
- **Robot View — servo↔joint binding & code-driven simulation (#313, epic #309
  Phase 3).** The keystone: a running MicroPython program's servo writes now
  animate the 3-D robot, **headless** (no board — it runs in the simulator).
  Bind a servo pin to a URDF joint in the pose tool's new **Servos** panel, with
  angle-range calibration (servo 0–180° ↔ joint min–max, plus invert); the map
  persists in `robot.yml` (`servoJointMap`). `inst.servo_on(pin).angle(...)`
  emits pin-keyed telemetry that drives the bound joint in real time — try
  `examples/servo-arm/` (open `arm.urdf`, Run `sweep.py`). Works tethered too
  (same telemetry path on a real board).
- **Robot View — pop-out, assembly panel & one-click STL import (#324, epic
  #309).** The docked mini 3-D viewer gains a **⤢ Pop out** button that opens the
  robot full-screen (Code mode) with the pose tool. The full-screen view now
  shows an **Assembly** panel — every link + the STL/mesh file it uses — and a
  **+ STL** button: pick a mesh and it's copied into the robot's KRF
  `urdf/meshes/` folder (collision-safe) and wired into the `.urdf` as a new link
  + fixed joint, so it appears in the model and the assembly immediately.
- **Robot View — Pose tool (#312, epic #309 Phase 2).** Opening a `.urdf`
  full-screen now gives a **pose tool**: a joint sidebar with a slider per joint
  (degrees for revolute, mm for prismatic) that moves the robot live, respecting
  the URDF limits. `<mimic>` joints follow their master (multiplier + offset),
  shown read-only. Edit a joint's min/max inline; save & recall **named poses**;
  and a **measure tool** reports the point-to-point distance between two clicks.
  Limit overrides + poses persist to `robot.yml` (KRF), and the docked Robot-mode
  panel gains an **⤢ Pose** button to open the robot full-screen. Also fixes the
  `robot.yml` (de)serialiser to round-trip the KRF `robot:` section.
- **Robot View — STL & DAE meshes (#319, epic #309).** Robot View now renders
  real robots: a URDF's `.stl` / `.dae` (Collada) meshes load straight from the
  project folder — no web server. Relative (`meshes/link.stl`) and `package://`
  paths both resolve against the URDF's folder, the URDF `<material>` colour is
  applied to meshes that carry none, and the camera reframes once they arrive. A
  mesh that can't load degrades to a small placeholder + a panel note (the rest
  of the robot still shows) instead of a blank model or a crash. Try
  `examples/mesh-demo/mesh-demo.urdf`. The mesh loaders stay code-split in the
  Robot View chunk.
- **Robot workspace mode (#320, epic #309).** A new **Robot** tab joins Code ·
  Board · Data Lab: files collapsed, your code on the left (~⅓), the Board View
  in the middle, and on the right a **mini 3-D Robot panel over the instrument
  dock** — code, wiring, the robot and live instruments in one glance. The 3-D
  view now defaults to an **isometric** (orthographic) camera, and the docked
  panel finds the project's URDF via the KRF `robot.yml` (falling back to the
  bundled demo arm). The 3-D engine stays code-split (only loads in Robot mode).

- **Robot View — 3D URDF viewer (#311, epic #309 Phase 1).** Opening a `.urdf`
  file now shows the robot model in a three.js scene with orbit / pan / zoom.
  URDF primitives render with no external meshes (the bundled
  `examples/demo-arm.urdf` is zero-setup), the camera auto-frames the model on a
  ground grid, and a malformed URDF shows a graceful error instead of a blank
  panel. The 3D engine is code-split, so it only loads when you open a robot.
  Built on the KRF format (#310); the pose tool, servo↔joint binding and motion
  timeline follow.

### Changed
- **Robot View — Join tool: the snap target is now directly clickable (#354).** The
  on-surface cross-hair showed exactly where a joint would land — but a click still
  measured its own pixel distance and often dropped a raw surface point instead, so
  the hole centre you were aiming at was frustratingly un-clickable. A click now
  lands on **exactly the snap the cross-hair is showing** (what-you-see-is-what-you
  -get), and the cross-hair **stays put as you move onto a hole** without needing to
  hold Shift (Shift still force-locks for large holes). A side effect: on a
  primitive block a joint pick always snaps to the nearest face handle
  (corner/edge/centre) — the exact point the target marker previews.
- **Robot View — a clearer selection highlight.** The selected block was outlined
  with a brass wireframe of every edge, which read as a see-through cage. It's now
  tinted **light blue**, keeping the material's shading (so the sides still shade
  rather than going flat). Clicking a part in the build hierarchy highlights it, and
  only **one** part is ever highlighted — even when parts are joined into a chain.
- **Robot View — Join tool: on-surface, colour-coded pick markers (#354).** The
  pick guides now read as painted onto the face: the **hover target** is a
  translucent **blue** disc, every **snap point** is a small translucent disc laid
  flat on the surface, and the committed picks are filled discs — **green** for
  component 1, **blue** for component 2 — each with a bright ring + axis triad, drawn
  on top so they're always visible.
- **Robot View — default view is the perspective "home" corner.** The viewer now
  opens in **perspective**, framed from the cube's **top-right-front corner**
  (+X/+Y/+Z), zoomed to fit — and that's exactly where the **Home** button returns.
- **Robot View — blueprint-style ground grid.** The grid is now much **lighter**
  and theme-aware (subtle on both white and black backgrounds), with **major +
  minor** subdivision lines, plus **red-X / blue-Z origin lines** through the
  centre. It re-colours live when the theme changes.
- **Robot View polish.** The **build menu defaults to pinned-open**; the
  navigation cube is **brighter brass** with its X/Y/Z labels **occluded** by the
  cube (no longer showing through); and the ortho/perspective dropdown collapses to
  just its ▾ arrow, revealed (like the Home button) only when the pointer is over
  the top-right nav zone.
- **Robot View — clearer measure tool.** Measuring now draws a **dashed line**
  between the two picked points with the distance shown in a **floating pill on
  the model** (mm / m), so you read it in context. Clears on re-measure or when
  the tool is turned off.
- **Robot View builder — tidier toolbar + panel.** The **add Box / Tube / Ball**
  buttons and the **Measure** tool moved onto the floating build toolbar (with the
  select / push-pull / move / join tools and undo/redo). The left panel keeps the
  hierarchy; **★ Make base** is now a one-click star on each block's row (no longer
  hidden in edit mode). The collapsed **Build** tab is squared off and reads
  top-to-bottom. Accent text in the builder (headings, the STL filename) uses a
  **darker brass** (`--accent-ink`) so it's readable on the parchment theme, and
  the toolbar's active-tool highlight is a neutral fill instead of hard-to-see gold.
- **Robot pop-out now keeps you in Robot mode.** Instead of switching to Code
  mode, popping the robot out (or creating a new one) enters a transient *focus*:
  it hides the board, instruments and console so the URDF fills the editor, and
  restores your Robot layout the moment you switch modes, re-click the Robot tab,
  or reopen any panel. Nothing about Robot mode is permanently changed.

### Fixed
- **Robot View — Join tool: the second block is now always selectable (#354).**
  After picking Component 1 it fades — but the faded mesh still hit-tested, so when it
  sat in front of the camera it stole every click and Component 2 "went dark and
  wouldn't select". The picker now **excludes the already-picked block** from the ray
  (and the selection highlight no longer draws a black outline that made the block
  look dark), so you can always click the other part.
- **Robot View — Join tool: only the first block fades.** Picking Component 1 faded
  the whole robot, because its material is usually shared (everything uses "steel");
  the fade now swaps in a transparent clone for just that block's mesh, so every
  other object stays solid and pickable as Component 2.
- **Robot View — the properties / Add-Joint dialog drags in place.** It jumped down
  and right on the first drag because the pointer's viewport coordinates were applied
  as `left`/`top` relative to the 3-D stage; the drag now converts by the stage offset.
- **Robot View — Pop-out opens in the home view.** Popping the robot out full-screen
  reused a preserved camera, so it wasn't fit/oriented; it now re-frames to home
  (as if you clicked the Home button) when it goes full-screen.
- **Robot View — deleting a joint now actually removes it (#354).** Delete used to
  re-attach the block to the base, which is a no-op for a joint that's already off
  the base — so those joints (e.g. the two fixed joints in a fresh robot) couldn't
  be removed. Delete now strips the joint outright; the block becomes free-standing
  and stays where it was (its position is baked into its visual origin so it doesn't
  jump).
- **Robot View — nav + mini-viewer polish.** The projection dropdown under the
  navigation cube no longer vanishes when you reach for it (it sat just outside the
  nav zone's hover box, so moving the pointer down dropped the hover; the zone now
  extends to contain it, and the target is a touch larger). The docked mini-viewer's
  **New robot** / **Pop out** buttons are readable in the light skin (they hard-coded
  a dark fill, so the dark label was dark-on-dark) and now use theme tokens. The mini
  viewer also gains a **Home** button (top-right) that flies back to the fitted
  default view.
- **Robot View — hierarchy dialog follow-ups (#353).** Renaming a pose onto an
  existing pose's name no longer silently destroys that pose (the rename is refused
  with an inline warning). The servo dialog's number fields hold raw text while you
  type, so you can clear a field or type a leading `-` (a negative joint range)
  without it snapping to 0. Switching hierarchy nodes mid-edit keeps the previous
  block's live edits (Fusion-style, still ⌘Z-undoable) and each node's **Cancel**
  now only reverts that node's own edits.
- **Robot View — a batch of navigation / layout fixes.** The **Home** button now
  responds to clicks (it sat under the cube canvas — it's raised above it and only
  captures clicks while the nav zone is hovered, so the cube corner stays pickable)
  and orients to the **top-left-front** corner. The first **Fit / 100%** no longer
  clips the model (the near plane was bracketed off the *far* end of the glide;
  it now uses the nearer end). The Properties dialog opens **comfortably below the
  nav cube** instead of behind it. In the Build hierarchy, the ☆/✎/✕ icons moved to
  the **left of the block name** so they no longer overlap long titles, and the
  panel now **sizes to its contents** (scrolling if needed) so it no longer covers
  the Help hint in the bottom-left.
- **Robot View — the Move tool now moves imported meshes.** It bailed on any link
  without primitive geometry, so STL/DAE parts couldn't be dragged; meshes now
  move (grabbing the hit point; primitives still get the face snap points). The
  Build hierarchy text is also a little larger (matching the breadboard browser).
- **Robot View readouts are readable in light mode.** The 3-D viewer's info/hint
  HUD (also the docked mini-viewer's text) used a dark pill, so its text was
  dark-on-dark on the parchment theme; it now uses a parchment pill with brass
  emphasis in light mode.
- **Robot View — imported meshes no longer render massive / clipped.** STLs
  authored in millimetres loaded 1000× too big (a huge mesh pushed the camera past
  the fixed far-plane, so only a "letterbox" sliver rendered). Imports now measure
  the mesh and normalise the scale (mm→m via `<mesh scale>`); the camera's near/far
  planes are also bracketed dynamically around the framed model so nothing clips at
  any size/offset.
- **Robot View — clicking a block in the hierarchy zooms to fit it**, and the
  navigation cube: **lighter brass**, 25% smaller, **longer X/Y/Z axes**, a
  **primary-button-only** guard (right/middle click no longer snaps the view), and
  a `pointercancel`/`lostpointercapture` reset so a stolen drag can't leave it
  orbiting on hover. A manual camera move (zoom / fit / home / focus / cube) is now
  preserved when async meshes finish loading (previously the settle re-frame wiped it).
- **Local Files refresh now updates expanded sub-folders too.** The refresh button
  re-read only the root listing, so files added/removed inside an already-expanded
  sub-folder didn't show up. Refresh now signals every expanded folder to re-read
  its children.
- **Robot View accent text is readable on the parchment theme.** The Robot-View
  panels hard-coded a light gold (`#c8a24a`) for highlight/active text, which
  didn't darken for the skeuomorph (parchment) theme — gold-on-cream was hard to
  read. They now use the theme-aware `var(--accent)` brass token (dark-brass on
  parchment, gold on dark), like the rest of the app. (3-D selection outlines /
  snap handles stay gold — the canvas is always dark.)
- **Files panel now always reopens from the toolbar button / activity icon.** A
  workspace switch (or the Robot pop-out) could leave the panel visually
  collapsed while the store thought it was open, so the next toggle click called
  collapse() and it stayed shut. The toggle now reads the panel's actual state
  and the switch syncs both ways, so it's self-healing.
- **Robot pose/servo panel is now legible in the light skin.** The panel used an
  undefined colour token, so it rendered dark-on-dark in the parchment theme; it
  now uses the theme surface tokens (parchment ⇄ charcoal) like the file panel.

## [0.24.0] - 2026-07-08

### Added
- **Data View — inspect logged CSV/TXT data as a table (epic #272).** Opening a
  `.csv` / `.tsv` file now shows a spreadsheet-like viewer instead of raw text.
  It auto-detects the delimiter (comma / tab / semicolon / whitespace) and header
  row, infers each column's type (number / timestamp / text), and tolerates the
  mess real device logs carry — ragged rows, blank lines and a torn final row
  (board unplugged mid-write) are handled, never fatal — with a "ragged" count
  and null markers for dropped readings. Rendering is **virtualised**, so a
  24-hour log (~86k rows) scrolls smoothly (#274). Click a header to **sort**
  (type-aware; nulls last), open a **filter** row (min–max ranges / text
  contains-equals, composable, with an "N of M rows" count + Clear), and a
  **summary strip** profiles each column and recomputes against the filtered
  set (#275). A **Columns** side panel (DuckDB Column Explorer style) profiles
  every column — histograms + min/max/mean/median for numbers, top values for
  text, and the null/gap % — glance-then-expand, recomputing live (#276).
- **Data Logger instrument — a vintage dot-matrix printer (#242).** Hit
  **RECORD** and every numeric `SNK` reading (meter, plot, distance, IMU,
  environment…) is captured with a timestamp and "printed" onto tractor-feed
  paper: a strip-chart per series plus periodic printed value rows in a dotty
  printhead style. **TEAR OFF** downloads the session as a spreadsheet-ready
  wide CSV (`time_s` + one column per series) and starts a fresh sheet. Works
  fully offline against the Simulated device, so a hardware-free classroom gets
  real data logging — a £4 Pico doing a £100 classroom logger's job.
- **Workspace layouts (epic #259).** A toolbar switcher restyles the whole shell
  in one click; each workspace remembers its own sidebar view, panel sizes,
  collapse states and instrument-dock visibility. Switching never remounts, so
  the editor, console scrollback and running instruments all survive. A **↺
  reset** restores the active workspace to its preset. All layout state moved
  into one versioned, corruption-safe store that migrates your existing layout
  on first run.
- **Open the Oscilloscope / Multimeter any time — with in-instrument help
  (#256).** The scope and meter no longer stay locked out until your program
  declares a PWM/ADC pin: toggle them on and, with no source yet, they show a
  built-in "how to use me" panel (a runnable `inst.watch(scope=pwm)` snippet +
  a Learn-more link), adopting the file's pin or live `SNK` telemetry the moment
  one appears. The **Barometer, IMU and Range** instruments explain themselves
  the same way (#258).
- **Reopen your files on launch, with crash-safe recovery (#266).** Snakie now
  remembers the open local files (and the active tab) and reopens them next
  time, alongside the working folder (#177). A crash-guard protects startup: if
  a file broke the app last launch it opens clean and drops that session so it
  can't loop — no keystroke or admin needed, which matters on a locked-down
  school machine.
- **Seven new Getting Started help articles (#231)** covering Files & sync,
  Flash MicroPython firmware, Install packages (mip), Problems & validation,
  Version control (Git), AI chat & autocomplete, and Keeping Snakie up to date;
  plus **mini-help for every standard-library part** (#213) — all 16 parts now
  ship a `help.md` (pinout + wiring + a runnable MicroPython snippet).
- **Pimoroni Motor 2040 + Servo 2040 in the Standard parts library (#224).**

### Changed
- **Three focused modes: Code · Board · Data Lab (#268).** The four-workspace
  switcher slims to three — *Lab* and *Data* merged into **Data Lab**; existing
  layouts migrate automatically. **Board mode now gives the board every pixel**:
  the parts **library** is an Obsidian-style pinnable overlay, the **connections
  table** collapses to a pinnable bottom bar, the floating **components browser**
  starts collapsed, and redundant chrome (the drag grip, the BOARD VIEW title,
  the New-board / boards-folder buttons, the dock's mini board) is hidden while
  the board is embedded. Part mini-help routes to the main **Help Library** (one
  help surface). The **Board toolbar knob pops the board out** into its own
  window (and closing it returns Board as a mode). Instrument dock defaults per
  mode: **closed** in Board + Code, **open** in Data Lab.
- **The breadboard is now graph paper.** The wiring background scales and pans
  WITH the parts like paper they're placed on: the smallest square is the real
  **2.54 mm** pin pitch (pads land on grid lines), 1-inch major lines anchor the
  view, and a finer grid fades in as you zoom (#297); it fills the whole stage
  and replaces the old static blueprint/schematic grids (#298). **Blueprint is
  the default background** and carries a subtle **procedural paper texture** —
  a fractal-noise mottle (SVG `feTurbulence`, no image) that pans/scales with the
  grid (#300, #301) — and the grid lines pick up that paper fibre so they wobble
  a hair like ink on paper instead of being machine-perfect (#307). The
  schematic view is a clean, grid-free sheet (#302).
- **Board View toolbar: snap-to-grid, a clickable zoom readout, cleaner
  framing (#299).** A **magnet** toggle snaps a dragged part's top-left pin to
  the nearest 2.54 mm intersection (remembered across sessions). The zoom
  percentage is a button toggling 100% / fit-all. Opening the components browser
  no longer jumps the zoom (only picking a component zooms to fit it).
- **Image/PDF/SVG exports match what's on screen and include everything.** They
  bake in the on-screen sheet colour (blueprint blue / schematic sheet), draw
  the grid + paper (and its wobble) to the edges, and always save the
  **zoom-to-fit** view so every placed item is included, uncropped (#302, #303,
  #304, #308).

### Fixed
- **Failures are no longer silently swallowed (#225).** A shared `reportError`
  helper replaces the `.catch(() => {})` sites that made failures invisible — it
  logs with a `[context]` tag and surfaces user-visible actions in the status
  bar, so the board never merely *appears* unresponsive.
- **Device-event broadcast survives a window closing mid-stream (#226).** Every
  send to the main / instrument / console / Board View windows is now guarded, so
  one window closing mid-broadcast can't stop the stream reaching the others.
- **Board-mode Help button opens the Help panel (#271)** — it expands the
  collapsed sidebar first — and the panel's minimum width was doubled.
- **Export no longer crops parts (#305)** — the frame now accounts for each
  translated part group's transform.
- **Session restore survives fast relaunches / dev HMR reloads (#266, #306)** —
  the crash-guard disarms on the next painted frame instead of after 4 s, so a
  quick reload can't strand its marker and wipe the session.

## [0.23.2] - 2026-07-04

### Fixed
- **Part Editor: the label colour picker is no longer squished.** In a text
  label's inspector the colour well + used-colour swatches were crammed into a
  narrow fourth column beside x / y / size, collapsing into a tiny bunched
  strip. The colour picker now sits on its own full-width row (like the board's
  Background colour), so the well and favourite-colour swatches lay out properly.

## [0.23.1] - 2026-07-03

### Fixed
- **In-app bug reports work in packaged builds (#206).** The shared feedback app
  key is now baked into release builds at build time (from a `SNAKIE_FEEDBACK_KEY`
  CI secret) and used as the `X-Snakie-Key` fallback, so installed apps can post
  bug reports without a logged-in session — previously the key was only read from
  a runtime env var, which packaged apps never had, so every report came back
  "not authorised". A runtime `SNAKIE_FEEDBACK_KEY` still overrides the baked key
  for development and self-hosting.

## [0.23.0] - 2026-07-03

### Added
- **Barometer gains a thermometer + humidity dial (#216).** The Barometer
  instrument now stands the aneroid dial beside a skeuomorphic mercury-in-glass
  **thermometer** (−10…50 °C, mounted on a dark backing strip that reads in any
  theme) and tucks a **much smaller hygrometer dial** into the footer — a 270°
  humidity gauge with a blue "DRY" arc and a red "DAMP" arc marking the extremes.
  The simulated device now also streams `SNK ENV` telemetry, so the dial,
  thermometer and hygrometer all animate on the virtual board.
- **Context help for standard MicroPython code.** Right-click → "Help for
  symbol" now covers the language itself, not just hardware modules: keywords
  (`if`/`while`/`def`/`class`/`try`/`import` …), value types (`int`, `str`,
  `list`, `dict`, `bytes` …) and everyday built-ins (`len`, `range`,
  `enumerate` …) open seven new mini-help reference articles — Control flow,
  Functions, Values & types, Built-ins, Classes, Errors & exceptions, and
  Imports & modules.
- **Device files refresh after installs.** Installing a part driver (either
  missing-library banner), the instruments library, or a mip package now
  re-lists the connected board's file tree automatically — the new files in
  `/lib` appear without clicking Refresh, in every window.
- **One-click install from the missing-library banner.** When the editor
  reports the connected board is missing a library your parts need, the banner's
  **Install** button now also covers parts that ship **bundled driver files**
  (SG90 / BME280 / ICM20948 …) — copying them straight onto the device, exactly
  like the instruments-library "Download & install". Previously only mip-URL
  libraries were installable from there. (Also: importing a driver directly no
  longer hides the missing-on-board nag just because a matching instrument looks
  in-use, and the simulated device's `exec` now really runs code, so probes work
  on the sim.)
- **Interactive I²C scanner (#214).** Found addresses in the I²C-detect grid are
  clickable: an inspector names the known devices for that address and offers an
  **ADD** button for any installed library part declaring it (new `i2cAddresses`
  part field; BME280 + ICM20948 declare theirs) — adding the part to the project
  and popping the breadboard.
- **Compass in the IMU instrument (#215).** A rotating 16-wind rose card under a
  fixed lubber line, with a `309° NW`-style readout driven by the magnetometer
  heading (the calibrated yaw).
- **Barometer instrument (#216).** Temperature / pressure / humidity as an
  antique aneroid barometer — brass bezel, 950–1050 hPa scale, RAIN · CHANGE ·
  FAIR legend — fed by `SNK ENV` telemetry; `inst.watch(weather=bme)` binds a
  BME280-style sensor automatically (instruments library 0.9.0).
- **Schematic buses (#217).** I²C/SPI wires in the Schematic view draw as short
  named bus tags (»I2C0«, »SPI1«) at both ends instead of routed noodles.
- **Animated I²C scan (#218).** Scan results play back as a cursor sweep across
  the grid, with a water-ripple "ping" on each found address.
- **Device-files management (#219).** Ctrl/Cmd + Shift multi-selection, drag
  files/folders into folders (a device-side move), a hover ✕ delete on every
  row, and "Delete N items" from the context menu. Deleting a folder now removes
  its contents recursively (previously directories couldn't be deleted at all).
- **Right-click context help (#221).** "Help for symbol (Snakie)" in the editor
  context menu opens the mini help for the word under the cursor — an installed
  part's bundled help (e.g. `bme280`) or a language-reference topic (Pin, PWM,
  I2C, sleep, …).

### Fixed
- **Device-files Refresh refreshes folders (#220).** Refresh re-lists every
  loaded folder — not just the root — keeping your expansion state.

## [0.22.0] - 2026-07-03

### Added
- **Watch an IMU → live 3-D attitude (instruments library 0.8.0).** `inst.watch(
  imu=my_imu)` now recognises a 6-/9-DoF IMU driver (any object with
  `read_accel_gyro` / `read_accel`+`read_gyro`, e.g. the ICM20948 part driver),
  lights up the **IMU** instrument, and `inst.update()` streams its orientation —
  roll/pitch from the accelerometer tilt, yaw from the magnetometer — so the
  attitude view "just works" with no trig in user code, exactly like a watched
  PWM drives the Oscilloscope.

### Fixed
- **Board part edits refresh live in other windows.** Authoring a board in the
  Part Editor (e.g. adding Qwiic I²C pins) now updates the main window's board
  list + the I²C-detect pin dropdowns immediately, instead of needing an app
  reload. `parts:savePart`/`deletePart`/`createLibrary`/`deleteLibrary`/
  `installLibrary` broadcast a `parts:didChange` to the other windows, and
  `useBoards` re-reads on it (and on the same-window parts-changed event).

### Added
- **Breadboard background setting + parchment library panel.** The Board View's
  library dock now uses the same warm **parchment** (`--bg`) as the local Files
  tree, so it reads as a matching sidebar. A new **Settings → Appearance →
  Breadboard background** control switches the wiring canvas between the default
  **Dark** workbench mat and a classic **Blueprint** (blue paper + light grid) —
  streamed live to the open Board View window. The Dark/Blueprint mat applies to
  the **Breadboard** view only; the **Schematic** view keeps a plain sheet that
  follows the skin — a white sheet with dark-on-white symbols in the light theme,
  the dark mat in the dark theme — since a blueprint doesn't suit a schematic.
- **BME280 + ICM20948 I²C sensor parts (Standard library).** Two new Pimoroni
  breakouts join the Standard parts library, each shipping a part footprint
  (I²C header), a bundled pure-MicroPython driver installed to `lib/` on placement,
  and mini-help with a runnable example: **BME280** (temperature / pressure /
  humidity, `from bme280 import BME280`) and **ICM20948** (9-DoF IMU — accel +
  gyro + magnetometer, `from icm20948 import ICM20948`).
- **Help button on a part's breadboard toolbar (#207).** Selecting a placed part
  in the Board View wiring canvas now shows a **?** Help button on its mini-toolbar
  when that part ships bundled mini-help — clicking it opens the Board View help
  drawer scrolled to and expanded on that part's article. Parts with no help don't
  show the button.
- **Drag parts onto the breadboard (#159).** Parts in the Board View's library
  dock are now draggable straight onto the wiring canvas — the canvas frames the
  drop zone while you drag, and the part lands centred under the cursor (with a
  saved canvas position) instead of the default auto-layout slot. Clicking a part
  still previews it; the existing "Add to project" button is unchanged. Dropping a
  part reuses the same placement path, so the driver-install offer + help toast
  still fire.
- **Per-part help: kevsrobots.com guide + open-example (#207).** A part's bundled
  `help.md` can now carry YAML front matter (`kevsrobots:` guide URL, `example:`
  tab name). When its article opens in the Help panel (from the "In This Project"
  section), a **📖 Full guide on kevsrobots.com →** link and an **⧉ Open example in
  editor** button appear above the article — the latter drops the article's first
  Python block into a new editor tab. Authored for the SG90 servo + Potentiometer.
- **Mini-map toggle in Settings (#210).** Settings → Editor now has a **Show the
  editor mini-map** switch (on by default) that shows/hides Monaco's mini-map live.
- **Flash-usage gauge in the device files panel (#211).** A slim used/total bar
  pinned at the bottom of the Device Files panel shows how full the board's flash
  is (`os.statvfs`), turning amber past 75% and red past 90%. Hidden when the board
  can't report it.
- **Potentiometer instrument + part (#212).** A new **Potentiometer** instrument
  reads a pot's wiper (an ADC voltage on the telemetry stream) as **0–100 %** on a
  skeuomorphic **B.S. First Grade** moving-coil ammeter, with a rotary knob
  mirroring the turned position and a % / volts readout. A new **Potentiometer**
  part (VCC · OUT · GND) joins the standard library with mini-help, and a watched
  ADC (`inst.watch(pot=adc)`) lights the meter up automatically.
- **Bind real objects to instruments — `inst.watch()` (prototype).** Register a
  live MicroPython object and the IDE offers the right instrument BY TYPE, via
  duck-typed introspection — no matter whose code created it. `inst.watch(pwm=pwm,
  pot=adc)` emits a `SNK BIND <name> <kind>` descriptor (PWM → Oscilloscope +
  Servo, ADC → Multimeter, I²C → scanner, Pin → LED/Button) and `inst.update()`
  streams each object's state on the existing telemetry, so a watched PWM lights
  up the scope/servo in the dock and drives them live. Control flows back
  (`SNKCMD watch <name> duty|freq|angle|value …`). (Library 0.7.0.)
- **ST7789 SPI TFTs in the Display instrument.** The Display panel now drives
  **SPI ST7789 colour TFTs** alongside the existing I²C SSD1306/LCD. The **SIZE**
  picker gains four ST7789 variants (**240×240**, 240×320, 135×240, 170×320);
  choosing one swaps the wiring to the SPI pins — **SCK · SDA(MOSI) · DC · RST ·
  CS** (RST **and** CS can each be **tied** — e.g. the Pimoroni Pico
  Explorer/Display has no reset GPIO and a hard-wired backlight) — with an RP2040
  SPI-pair invalid-pin warning, a `screen spi …` retarget over the control channel,
  and a bundled on-device `ST7789` driver (`inst.start(screen_sck=…,
  screen_mosi=…, screen_dc=…, screen_rst=…, screen_cs=…)`) that renders
  **band-by-band** (a small reusable strip, so it never needs a ~150 KB full-screen
  framebuffer that fails to allocate on a Pico). Mirror + Push work over both buses;
  a **Run ST7789 demo** fallback (`examples/st7789_demo.py`) wires the panel's pins.
  (Library 0.6.1.)
- **Manual pin-label placement (Part Editor).** Drag a pin's label annotation
  (number box + label + capability chips) to a hand-placed spot — e.g. clear of the
  board outline — to declutter dense boards. It's persisted per pin as `labelOffset`
  in `parts.yml`, reflected in the Board View + Mini Board too, and a **Reset label
  position** button in the pin inspector returns it to the default.
- **Breadboard hover reveals pin capabilities.** In the board view, hovering a
  placed microcontroller now shows **every** pin's capability chips — positioned to
  the pin's left/right/top/bottom like the Part Editor (`SDA`, `SPI1 SCK`, `ADC2`,
  `PWM A`, …) — fading in from the board centre outward, and clearing the pin names.
  Hovering a specific pin dims the other pins' chips to 40% so its own stand out;
  everything disappears when you mouse off the part.
- **Connectors — QWIIC / STEMMA QT / JST (Part Editor).** A new **Connectors**
  layer adds a **QWIIC** / STEMMA QT socket (a 4-pin JST-SH I2C connector,
  prefilled GND · 3V3 · SDA · SCL) or a generic **JST** header. Its contacts are
  **full pins**, so you assign each a **GP##** (+ the I2C bus for SDA/SCL) and the
  usual type/role in the inspector. It's drawn on the board as a JST housing with a
  `QWIIC · SDA GP4 · SCL GP5` label, is draggable, and persists in `parts.yml`
  under `connectors`.
- **Onboard LEDs, RGB & NeoPixels (Part Editor).** A new **Onboard LEDs** layer
  (in the top panel, right above the inspector) lets you add an indicator with
  **＋ LED**, then pick a **type** and assign GPIO(s): **LED** (one GPIO, e.g. the
  Pico's GP25), **RGB** (R/G/B on three GPIOs, e.g. the Tiny 2350's GP18/19/20),
  or **NeoPixel** (a WS2812 on a DATA GPIO + an optional power-enable GPIO, e.g.
  the Seeed XIAO RP2350's GP22 + GP23). Each is drawn on the board as a glowing
  glyph with a `LED · GP25` / `RGB · GP18 GP19 GP20` / `NeoPixel · GP22 · PWR GP23`
  label, is draggable, and persists in `parts.yml` under `onboardLeds`.
- **Pin signal designations, bus numbers + GP## labels (Part Editor).** When a
  pin's capability is ticked, controls let you designate its **signal** — **I2C** →
  SDA/SCL, **SPI** → RX/CSn/SCK/TX, **UART** → TX/RX, **PWM** → the A/B channel —
  and its **bus / channel number** — **I2C**/**SPI**/**UART** bus id and the **ADC**
  channel. The capability chip shows both (e.g. `I2C0 SDA`, `SPI1 SCK`, `ADC2`,
  `PWM A`). The pin's **GP##** GPIO is drawn next to it when the silk label differs
  from the GPIO. Persisted in `parts.yml` under each pin's `signals` / `buses`.
- **Rotate a pin from its mini-toolbar.** Selecting a pin in the Part Editor now
  shows a **Rotate 90°** button in its floating mini-toolbar (next to Duplicate),
  so you can spin a pin — its silk label and, on castellated pads, the outward
  half-hole — without opening the inspector.
- **Pin capabilities show next to the label.** A pin's ticked capabilities now
  appear as persistent colour-coded chips beside its label — in the fixed order
  **PWM, ADC, SPI, I2C, UART**, using the shared capability palette — instead of
  only on hover, so a board's signals are readable at a glance.

### Changed
- **Clearer breadboard wire routing.** A wire between two pins that face away from
  each other (e.g. two 5V pins on opposite sides of their boards) no longer
  U-turns back over itself — it now bows up/over or down/under so it's clear where
  it starts and ends.
- **Pin capability controls stack one row per capability.** The bus + signal
  fields for each ticked capability now sit on their own row (instead of one
  crowded line), so the labels and dropdowns no longer clash.
- **Bigger, sharper castellated pads.** Castellated pads render a touch larger at
  the real ~2.5 × 1.7 mm aspect, with **sharp corners on the board-edge (castellated)
  end** and a rounded inner end.
- **Two themes: Light & Dark.** The default textured skin is now called **Light**
  and the old flat light theme has been removed (any saved "light" preference maps
  to the new Light). The theme picker moved off the toolbar into **Settings →
  Appearance**.
- **Settings moved to the shelf.** The Settings gear left the toolbar for a
  **Settings** item on the activity bar (below Help), styled like the other shelf
  icons; it opens Settings on the new Appearance tab.
- **Part Editor's Pins list is sorted.** It now orders pins by board number
  (numbered pins first, ascending) and falls back to label text (numeric-aware,
  so `GP2` sorts before `GP10`) for pins without a number.
- **Line spacing is always adjustable.** The Settings line-spacing slider is no
  longer disabled when notebook paper is turned off (it's also the editor line
  height).
- **Zero-padded board pin numbers.** Single-digit pin numbers are drawn as `01`,
  `02`, … on the breadboard, Board View and Mini Board View, so pin columns and
  their capability chips line up.

### Fixed
- **Removing a part clears its "your code doesn't import …" nag.** The main
  window's parts-import banner only re-read `robot.yml` on connect / file-open /
  folder change — not when the Board View window added/removed a part. It now
  refreshes on a cross-window robot-changed signal, so removing e.g. the SG90
  drops its import prompt immediately.
- **The board-library UPDATE prompt now actually fires (version was misparsed).**
  `parseLibVersion` matched the first `__version__ = "…"` in the source — which was
  the `"X.Y.Z"` example inside the doc comment above the real assignment. So every
  copy (board + bundled) read as `X.Y.Z`, always "equal" → the "Update library"
  banner never appeared for an out-of-date board. Anchor the match to the start of
  a line so the real `__version__ = "0.7.0"` wins.
- **Out-of-date board library is now detected without the Instrument Dock open.**
  The "Update library" check + banner were gated on the Instrument Dock being on
  screen, so a stale `instruments.py` went unflagged while you edited/ran code with
  the dock closed. The probe now runs as soon as a board connects (it backs any
  `import instruments` program) and the banner shows whenever the board's library
  is missing/outdated, re-offering on each reconnect.
- **A part driven through its instrument no longer nags for its driver.** A placed
  part used via its INSTRUMENT (e.g. `servo_showcase.py` → `inst.start(servo_pin=0)`)
  no longer shows "this file doesn't import servo" / "the board is missing servo" —
  the driver import + file are only needed when you use the driver library.
- **Popped-out console is no longer blank.** When you pop the console into its own
  window it now redraws the existing scrollback instead of starting empty — the
  docked console's output is handed to the detached window and replayed through
  the same telemetry filter (so `SNK` telemetry stays hidden and colours are
  kept) before it follows the live stream.
- **Part Editor's save notice no longer nudges the UI.** The "Saved …" / error
  notification now floats as a toast over the top of the editor instead of
  taking layout space, so the canvas and panels stay put when it appears.
- **Readable pin labels in the Light theme.** The Part Editor's pin label text and
  board numbers now render near-black on its light canvas (they were tuned as
  light-grey for the dark theme). This is scoped to the Part Editor — the Board
  View and Mini Board View are intentionally dark in every theme, so they keep
  their light labels + dark number chips.
- **Readable instrument-dock labels.** The dock's title, the Inputs/Outputs group
  captions and the inactive toggle icons were a very dark grey on the near-black
  dock (low-contrast in both themes); they're now a lighter grey.
- **Readable accent text.** The SAM instrument's "Open demo" link and the
  bug-report "sent" confirmation used a low-contrast brass; they now use the
  editor text / success-green colours so they read in both themes.
- **Bug-report screenshot keeps its aspect ratio.** Enlarging a multi-window
  screenshot no longer squashes it vertically — the preview keeps the true aspect
  (and scrolls if tall), matching the thumbnail.

## [0.21.0] - 2026-07-01

### Added
- **Pop the console out into its own window.** A pop-out button appears at the
  console's top-right on hover and detaches the bottom REPL into its own native,
  resizable OS window — kept live (the device stream is relayed to it) and fully
  interactive. Close the window or click **Redock** to bring it back; the docked
  console keeps its scrollback intact throughout.

### Changed
- **Decluttered console header.** Removed the "Shell" title (frees space on small
  screens; the actions fill the row) and sized the **Clear** button to match the
  Connect/Disconnect control.

## [0.20.3] - 2026-07-01

### Changed
- **Richer bug reports (#206).** A report now captures **every open Snakie
  window** — the main window plus the Board View and any undocked instrument
  windows — composited into one screenshot, and the thumbnail is
  **click-to-enlarge** so you can review it (for anything sensitive) before
  sending. Reports also auto-attach **environment diagnostics** (Snakie version,
  platform/OS, connected board, date & time) and, only if you opt in, the
  **recent console output** — previewable first in a small scrollable dialog.
  The privacy confirmation now covers the console output too.

### Fixed
- **Console terminal no longer overlaps the skeuomorphic screen.** The black
  xterm is clipped to the recessed console screen, so resizing never spills it
  over the bezel or rounded corners.

## [0.20.2] - 2026-07-01

### Changed
- **Bug report screenshot: thumbnail, Snakie-only, and a privacy confirmation
  (#206).** Attaching a screenshot now shows a **thumbnail** with a "Snakie window
  captured" confirmation (plus Retake/Remove), and the copy makes clear it
  captures **only the Snakie window** — never your whole screen or other apps. A
  **required checkbox** now confirms the report (screenshot + pasted text/code)
  contains no personal or sensitive information before it can be sent.

## [0.20.1] - 2026-07-01

### Changed
- **Bug reporter is now a non-modal left panel (#206).** "Report Bug" opens a
  docked left-sidebar view (above Help) instead of a modal, so the editor and
  console/REPL stay fully interactive — you can copy error output or code straight
  into the report while it's open. Reports can now land without a kevsrobots.com
  login: the app sends an `X-Snakie-Key` (`SNAKIE_FEEDBACK_KEY`) for the server's
  anonymous, key-gated `_SNAKIE_` feedback path.

## [0.20.0] - 2026-07-01

### Added
- **Part Editor: author on-board buttons (#130).** Add push-buttons (BOOT/RESET/…)
  with a new "Push-button" tool and a "Buttons" layer panel: place, drag (grid-snap
  + smart-alignment), label and delete them, with full undo/redo. They render as a
  tactile-switch glyph in the Part Editor and the Board Views. This completes the
  #130 Part Editor checklist (buttons were the only remaining item).
- **In-app bug reporting (#206).** A "Report Bug" button in the activity bar (above
  Help) opens a form — title, description, optional email, and an attach-a-screenshot
  button that captures the app window — and submits to kevsrobots.com's feedback API,
  tagged `_SNAKIE_`. It runs in the main process past the CSP and fails gracefully.
  (The endpoint authenticates the reporter, so landing reports needs a provisioned
  `SNAKIE_FEEDBACK_TOKEN` — or an anonymous `_SNAKIE_` path — added server-side.)
- **Part-level update indicator (#155).** When a part's library has a newer
  version available, an update badge now also appears next to the affected parts
  (not just the library header); clicking it updates the library — and so the
  part — to the latest version.
- **Resizable mini board / instrument-deck split.** Drag the handle beneath the
  mini board view to give it more or less room versus the instrument deck below
  (double-click the handle to reset). The split is per-session — it always opens
  at the current default size and isn't persisted.

### Fixed
- **Re-showing an undocked instrument returns it to the dock.** After undocking a
  singleton instrument into its own OS window (#205) — the Plotter or any of the
  panels (gamepad, scanners, LED, buzzer, …) — hiding then re-showing it via its
  dock-header icon brought it back windowed (or made it vanish) because its
  undocked state wasn't reset. Toggling a singleton back on now re-docks it, the
  same way the oscilloscope/multimeter already did.

## [0.19.0] - 2026-06-30

### Added
- **Undocked instruments are true OS windows (#205).** Undocking an instrument now
  opens it in its own native, **resizable** OS window (the Board View / Find
  precedent) instead of an in-app floating overlay — so you can move it to another
  monitor, and the **Plotter** (and the scope/meter) reflow as you resize the
  window. The detached instrument stays live: the device telemetry stream is
  relayed to every instrument window. Closing the window (native ✕ or the in-window
  Dock key) re-docks the instrument. The **Plotter is now undockable** too.
- **Status-bar messages for file syncing (#178).** The status bar now narrates
  what file syncing is doing: when you tag/untag a file, when you turn the sync
  toggle on or off, and for every automatic push on save (`Syncing main.py…` →
  `main.py synced to the board`, or a clear error). Messages are transient and
  auto-clear, complementing the small toolbar glyph.

### Fixed
- **Simulated device: file operations no longer fail with "NULL object".** The
  offline device's filesystem helpers (list/read/write/stat) now run their Python
  via the interpreter's **synchronous** exec instead of the Asyncify path, whose
  reentrancy could make a nested call return a NULL object — which surfaced as
  "NULL object" in the device-files panel and when installing the instruments
  library. `writeFile` now also **creates missing parent directories** (the
  in-memory VFS starts empty, so `/lib` is made on demand).
- **Simulated device: clearer message for `mip` installs.** Installing a `mip`
  package (e.g. the SAM speech library) on the offline device now reports that
  package install needs a network connection and a real board, instead of a
  cryptic "mip failed" (the WASM port has no `mip`/network).
- **No more `MaxListenersExceededWarning` for device status.** `useDeviceStatus`
  (used by ~18 components) now shares a single `device:status` subscription that
  fans out to all callers, and the preload raises the IPC listener ceiling for
  the legitimately multi-subscriber broadcast channels (`device:data`/`status`).

## [0.18.1] - 2026-06-30

### Fixed
- **Raspberry Pi: disable GPU rendering to stop VSync errors.** On the Linux
  arm64 (Pi) build, hardware acceleration is now disabled — the Pi's GL stack
  can't report VSync timing to Chromium, which spammed the console with harmless
  `GetVSyncParametersIfAvailable() failed` errors and could make GPU compositing
  unreliable. Software rendering is steadier for this UI on a Pi 4/5. Set
  `SNAKIE_ENABLE_GPU=1` to keep hardware acceleration.

## [0.18.0] - 2026-06-30

### Added
- **Raspberry Pi build (Linux arm64).** Releases now include an arm64 AppImage,
  `Snakie-<version>-arm64.AppImage`, for **Raspberry Pi 4 / 5 on 64-bit Pi OS**.
  It's built on a native `ubuntu-24.04-arm` runner (so the `serialport` native
  module is the correct arm64 build) and ships as an AppImage only (the arm64
  `.deb` is skipped because electron-builder's bundled `fpm` is x86-only).
- **Add Snakie to the Raspberry Pi / Linux menu.** A helper script
  (`scripts/install-linux-menu.sh`) installs a desktop entry + icon for the
  AppImage so Snakie appears in the menu under **Programming** (`Categories=
  Development`). Re-run it after updating, or `--uninstall` to remove it.

## [0.17.0] - 2026-06-30

### Added
- **Keep local files in sync with the device (#178).** Tick the **checkbox** next
  to a file in the Local files tree to keep it in sync with the connected board
  (untick to stop). A tagged file shows a green **⇄** sync glyph at rest; hovering
  the row swaps the checkbox back in so you can untick it. A single **sync toggle**
  on the device-files toolbar turns syncing
  on — pushing the tagged files immediately **and** keeping them in sync on every
  save — and off again. Its icon spins while syncing and becomes a **green tick**
  for a moment when a sync completes (the device tree refreshes so the pushed
  files appear). Each tagged file maps to `/<filename>` on the device; the tagged
  set and the toggle persist across reloads. Device-file editor tabs are now shown
  in **brackets** (e.g. `[main.py]`) to tell them apart from local files.
- **Offline mode — a simulated MicroPython device (#135).** Snakie now ships a
  built-in **Simulated device (offline)** that appears in the shell's port
  dropdown, so you can explore, learn and demo with **no hardware connected**:
  - It runs a **real MicroPython interpreter** (compiled to WebAssembly), so the
    **REPL and the Run button work for real** — `print("Hello, World!")`, loops,
    maths and the rest run and stream their output to the console. Hardware
    modules (`machine`, etc.) aren't available, so importing them raises
    `ImportError`, just like a board without that peripheral.
  - On top of the interpreter it emits a live, animated stream of `SNK …`
    telemetry, so the **instruments** (oscilloscope, multimeter, plotter, IMU,
    distance, encoder, button…) animate immediately, and it answers the **Board
    Viewer Live View**'s pin probe with plausible values that drift over time.
  - A distinct **"Simulated device · offline"** status-bar badge (amber LED) and
    a matching **SIMULATION** badge on the mini board viewer, so the board's pins
    are never mistaken for real hardware. Switching between the simulator and a real
    board is seamless (connecting to one disconnects the other).
  - Typing in the simulated REPL now handles spaces correctly (the console
    telemetry filter no longer absorbs a lone echoed space into the next `SNK …`
    line).
  - The simulated device has a **real in-memory filesystem** (the interpreter's
    VFS): uploaded files persist, list, read back and are **importable** — e.g.
    you can upload `instruments.py` to `/lib` and `import instruments` from the
    REPL (`/lib` is on `sys.path`). It's RAM-backed (not a fixed flash size) and
    resets on disconnect.
- **Accessibility quick wins (#188).** First pass over the renderer's
  accessibility audit:
  - The device REPL is now readable by screen readers — the xterm terminal runs
    in `screenReaderMode` and its container is a labelled `group` ("Device REPL
    console").
  - A single global `:focus-visible` ring now covers every interactive element
    that lacked a themed focus indicator, so keyboard focus is always visible.
  - A global `prefers-reduced-motion` block (plus gating the terminal cursor
    blink on the same preference) stops infinite pulses and transitions for users
    who ask for reduced motion.
  - A contrast pass raised the muted-text tokens (dark + light skins) and the
    dark editor's inactive line numbers / comment syntax to meet WCAG AA.
  - Glyph-only controls now expose real accessible names (Find's Match-case /
    Whole-word toggles, the plugin reload knob, the status-bar git branch count),
    with the decorative glyphs hidden from assistive tech.
  - Live regions announce async status that was previously silent: the Find
    match count, the top install banners, and the firmware flash progress /
    outcome.
  - Modal dialogs (Prompt, Settings, Firmware flasher) now trap Tab focus, move
    focus in on open and restore it to the trigger on close via a shared
    `useFocusTrap` hook; the Firmware flasher and Prompt modals also close on
    Escape from any control.

## [0.16.1] - 2026-06-30

### Added
- **Pimoroni Tiny 2350 in the Standard library.** Authored with the
  build-part-from-image skill (#198) — **16 castellated pads (8 per edge)** whose
  pinout is verified against Pimoroni's official Pins-and-Dims diagram: left edge
  (USB at top) **5V, GND, 3V3, A3 (GP29), A2 (GP28), A1 (GP27), A0 (GP26), GND**;
  right edge **GP0–GP7**. RP2350A, USB-C, RGB LED, BOOT/RST buttons and the Qw/ST
  connector. Ships a **life-like background photo with the background removed**
  (transparent) so the castellated edge renders cleanly. Its id matches the
  built-in board, so the Board View renders the Tiny 2350 life-like.

### Changed
- **build-part-from-image skill hardened for correctness + realism.** Pin
  assignments must now be verified against a real **pinout diagram** (not the
  product photo), with a **pad-count reconciliation** and a power/ground safety
  check, then confirmed with the user before finalising — this caught a dangerous
  5V/GND swap and a dropped GND pad on the Tiny 2350. The skill also **removes
  image backgrounds** (macOS Vision foreground mask, via the bundled `rmbg.swift`)
  and **assesses** the cutout, telling the user to use a smarter tool when it fails.

## [0.16.0] - 2026-06-29

### Added
- **Standard library updates (epic #191).** The Parts Library now keeps a
  versioned **Standard library** in step with GitHub:
  - **Categories with section headers** — parts are grouped under their category
    (Microcontroller, Computer, Sensor, Input, Output, Motor, Display,
    Communication, Power, IC, …) instead of a flat list (#193).
  - **Any component type** — the Standard library holds any part, not just
    microcontrollers (renamed *Standard Boards → Standard Parts*) (#192).
  - **Update check on startup** — Snakie checks GitHub for newer library versions
    at launch and caches the result (#194).
  - **Refresh** reloads parts from disk **and** re-checks GitHub (#195).
  - **"Updates available" indicator** with one-click **Update all** — each install
    is a fresh clone, so the new version is used immediately (#196).
  - **Publish (developer mode)** — a dev-only button bumps the Standard library
    version and pushes its git checkout to GitHub (#197).
- **Part-builder skill (#198).** A Claude skill (`.claude/skills/build-part-from-image`)
  that turns a product-page / part image + pinout into a Snakie part — extracting
  pins and drawing the defining components with the shapes & text tools
  (important features only; no copper traces).
- **Common robotic parts list (#199).** `docs/common-parts.md` — a curated
  wishlist of common parts to drive the part-builder skill.

## [0.15.1] - 2026-06-29

### Fixed
- **Firmware-update check no longer offers a cross-family build on connect.** The
  device's boot banner arrives over serial in chunks, so `MicroPython v1.28.0 …`
  could be read before the trailing `… with RP2040`. The check latched onto that
  partial line, couldn't identify the board family, and fell back to the
  catalog-wide newest — briefly offering a Raspberry Pi Pico the **micro:bit's
  2.1.2** (a separate 2.x version line). The check now finalises only once it can
  identify **both** the version and the board family from the banner (re-checking
  as the rest of the banner arrives), and never falls back to the catalog-wide
  maximum, so an rp2/esp device is only ever offered its own family's firmware.

## [0.15.0] - 2026-06-28

### Added
- **Undo / redo for every Part Editor operation (#187).** **Ctrl/Cmd+Z** undoes and
  **Ctrl/Cmd+Shift+Z** (or **Ctrl+Y**) redoes any change — pins, shapes, holes, text,
  image, dimensions, properties, drag/resize, alignment, paste-style and deletes —
  with **Undo / Redo toolbar buttons** too. A drag collapses into a single undo step,
  and the history resets when you start a new part.
- **Copy style / Paste style across the Part Editor.** Every element's mini-toolbar
  (shapes, text labels, pins and mounting holes) now has **Copy style** and **Paste
  style** buttons. Copy captures just the element's styling — a shape's fill /
  outline / corner radius + all caption styling, a label's font size / colour /
  bold-italic-underline / alignment, a pin's pad shape + type + capabilities, a
  hole's diameter — and Paste applies it to another element **of the same type**
  (Paste is disabled for a different type or an empty clipboard).
- **Mounting-hole mini-toolbar.** Selecting a mounting hole now shows a floating
  toolbar (like shapes/labels) with **Duplicate**, a **Size** control (a diameter
  slider + mm value) and **Delete**. Pins gained a small toolbar too (Duplicate +
  Copy/Paste style).
- **Install a part's MicroPython drivers from the Board View (#184).** A part can
  declare the driver file(s) it needs on the board (`drivers:` in `parts.yml` — a
  `source` + a `target` path, plus an optional label). When such a part is placed
  on the breadboard, the Board View shows a consent-first banner listing the parts
  that need a driver with an **Install drivers** action (nothing is copied without
  your click). Files are copied into place — creating folders as needed — via the
  device file-write API, and `github:`/`pypi:` specs install with `mip`; the banner
  shows per-driver progress + errors and waits for a connected board. The bundled
  `vl53l0x` example part ships a driver to demonstrate it.
- **Edit shape text inline + on multiple lines.** A shape's caption is now a
  multi-line **Text** field (Enter = new line), and you can **double-click a shape**
  to edit its text right on the canvas. Alignment buttons use proper left/centre/
  right icons (kept together on one row).
- **Mounting-hole tool in the Part Editor toolbar.** A dedicated toolbar button
  arms the add-mounting-hole tool (previously only reachable from the Layers panel).
- **Used-colour swatches on every Part Editor colour well.** The quick-pick grid of
  colours already used in the part (fills, strokes, label/text colours, PCB colour)
  now appears on **all** colour wells — the mini-toolbar fill/border/text dropdowns
  and the Properties panel's fill, outline, label, free-label and background pickers
  — so you can reuse a colour in one click anywhere.
- **Native window chrome + Window-menu listing for secondary windows (#185).** The
  **Board View** and **Find & Replace** windows now use the standard OS title bar
  (close / minimize / maximize) instead of being frameless, so the OS **Window menu
  auto-lists** every open window and they're more accessible. The in-app close
  button was removed in favour of the native one; a **View → Board View** item
  (⌘/Ctrl+Shift+B) still opens or focuses the Board View.
- **Styled text on Part Editor labels & shapes.** Free text labels and a shape's
  caption can now be **bold / italic / underlined**, sized, **coloured**, and
  **aligned** (left / centre / right); shape captions can also **wrap to the shape**
  (multi-line). Edit it from the Properties panel or from an **"A" text dropdown on
  the selected-component mini-toolbar** (size, colour, B/I/U, align, wrap). Rendered
  as pure SVG (manual word-wrapping) so it still exports to PNG/SVG/PDF; round-trips
  in `parts.yml`.
- **Adjustable rectangle corner radius in the Part Editor.** Rectangle shapes were
  always drawn with rounded corners; you can now set the **corner radius** (down to
  0 for sharp corners) from a slider + value box in the **Properties** panel and in
  the selected-shape mini-toolbar's **Border** dropdown. Round-trips in `parts.yml`.
- **Generate project docs from the Board View — BOM & pinouts (#127/#142/#143).**
  The Export menu now also produces two portable **Markdown** documents from the
  project's `robot.yml`: a **Bill of Materials** (microcontroller first, then parts
  grouped by type with quantities + the metadata from each `parts.yml`) and a
  **pinouts table** (MCU-pin-first rows for board wires, with part↔part wires
  listed separately). Both save as `<project>-bom.md` / `<project>-pinouts.md`.
- **Flash MicroPython to the BBC micro:bit (v1 & v2).** The firmware flasher now
  **detects a connected micro:bit** (the `MICROBIT` DAPLink drive, reading
  `DETAILS.TXT` to tell v1 from v2) and flashes the **latest MicroPython** by
  copying the right `.hex` onto the drive. Firmware versions come from Thonny's
  curated `daplink` catalog (the same source Thonny uses), so the list stays
  current; the dialog pre-selects the matching v1/v2 build. If the micro:bit is in
  **maintenance mode** (the `MAINTENANCE` drive) the flasher detects it but blocks
  the flash with guidance to reconnect normally — flashing MicroPython there can
  soft-brick the board.
- **Selected-component toolbar in the Part Editor.** Selecting a shape or text label
  now floats a dark mini-toolbar above it to **duplicate**, **rotate** (90° steps) or
  **delete** it; shapes also get a quick **fill** picker with a **grid of colours
  already used in the part** for one-click reuse, and a **border** dropdown (width
  slider + value and a border colour well).
- **Multi-select + align components in the Part Editor.** Shift/Ctrl-click shapes and
  labels — or drag a marquee around them — to select several at once, then use the
  **alignment toolbar** (left/centre/right, top/middle/bottom, distribute) to line
  them up. Pins and components can be aligned together in one selection. Dragging a
  single shape/label now also shows the **smart-alignment guides** (it snaps its
  centre to other items), matching pins.
- **Floating project browser on the Board Viewer.** The project name + description
  and the component hierarchy (the microcontroller + placed parts) now live in a
  **floating, collapsible browser** pinned top-left of the canvas (Fusion-360
  style), instead of the bottom dock. Collapse it to a small tab to reclaim space.
- **Export the board as an image.** The board view's zoom toolbar has an **Export**
  button offering **PNG**, **SVG** or **PDF** — it saves the whole drawing framed
  at 1:1 (independent of the current pan/zoom), named after the project.
- **Duplicate a part on the breadboard.** The selected-part toolbar gains a
  **Duplicate** button that drops a copy (fresh id, offset a little) and selects it.
- **SAM text-to-speech instrument (#167).** A new **SAM** (Software Automated Mouth)
  instrument in the dock: type into the speech bubble, pick the buzzer/speaker pin
  from a **dropdown of the selected board's GPIO pins**, and **Speak** — the IDE makes sure the [`sam`](https://github.com/kevinmcaleer/sam)
  library (with its `sam_render.mpy` accelerator) is on the board, installing it if
  needed, then synthesises the text out of that single pin. **Open demo** drops a
  runnable `sam_demo.py` into the editor.
- **Newer-firmware check (#173).** When a device is connected, Snakie reads its
  running MicroPython version from the REPL boot banner and compares it against the
  newest stable build in the firmware catalog. If a newer version exists, a prompt
  appears above the **Flash firmware** button (with a one-click **Flash**). A new
  Settings → *Firmware updates* toggle disables the check.

### Changed
- **The node-graph Board View shows the authored life-like board.** Instead of a
  stylised edge-laid pinout, the node-graph now draws the board's **real authored
  body** (image + component shapes + pins at their true positions) — identical to the
  Breadboard view and the Part Editor — and routes the connection wires to the real
  pad positions. The full Board View also opens on the **Breadboard** tab by default
  (remembered), so it matches the main window's mini board preview.
- **Centred Board View zoom.** The node-graph zoom (−/+ buttons and the mouse wheel)
  now keeps the board **centred with its top in view** (the wheel zooms toward the
  cursor) instead of growing out of the top-left corner.
- **Boxed pin annotations everywhere.** In the **mini board view**, the
  **breadboard (life-like)** microcontroller, **and the Part Editor**, each pin now
  shows a **grey board pin-number box** (the physical pin number, not the GPIO) next
  to the pad, then the **pin label**, then (for pins used in the code) the **code
  variable** — laid out outward from the pin and mirrored for each facing
  (left/right/top/bottom), so the editor preview matches the board views.
- **Mini board view renders the authored part.** For a board backed by a Parts
  Library microcontroller, the mini board now draws the part's **real body** (board
  image + component shapes + pins at their authored positions) via the same
  `PartBody` renderer as the Part Editor / full Board Viewer — with the boxed pin
  numbers + the code variable on used pins — instead of a stylised PCB. Built-in
  boards (no source part) keep the stylised fallback. The view is framed to its live
  content, with **hover zoom controls** (in / out / fit) and a scrollable viewport.
- **Collapsible connections table.** The Board Viewer's bottom connections table
  can now be **collapsed to its header** (and restored) to free up canvas space.
- **Cleaner part on the breadboard.** Removed the small ✕ remove badge from each
  placed part (it could clash with the part's title) — the selected-part toolbar's
  **trash** button is the single, tidier way to delete.
- **The parts list shows the board.** The component browser pins the currently
  selected **microcontroller** at the top (tagged "MCU"), listed alongside the
  parts wired to it.
- **Part versions auto-bump on edit (#172).** Saving an edited part now
  automatically increments its **PATCH** version when its content actually
  changed, so updates are easy to detect (a manual version change you make is
  respected instead). Combined with the existing library update checks, both
  parts and libraries are now version-tracked.
- **Smoother breadboard wiring (#182).** Breadboard wires are now **Node-RED-style
  Bézier noodles** that leave each pad with clearance in the direction the pin is
  **oriented** (a right-facing pin's wire leaves to the right, a top/bottom pin's
  upward/downward) and curve cleanly to a pin on the far side of a board (replacing
  the orthogonal routing). Wires now also draw **on top of the parts** instead of
  disappearing under a body, and they reflow live as you drag a part. (Schematic view keeps its
  right-angle routing.)

### Fixed
- **Firmware-update check no longer crosses board families.** With the micro:bit's
  separate **2.x** firmware line now in the catalog, a Pico (rp2, on 1.28.0) was
  wrongly told the micro:bit's **2.1.2** was a newer build — and the reported device
  version could come from a previously-connected board still in the console buffer.
  The check now reads the **most-recent** boot banner and compares only within the
  **connected board's own family**.
- **Part Editor pin labels on the top/bottom edges read vertically again.** After
  the boxed pin-number annotation landed, top/bottom pins drew their labels
  horizontally (so a dense column collided); they now rotate ±90° to run outward
  along the pin, matching the left/right edges and the previous behaviour.
- **Shape size shown in millimetres in the Part Editor.** A rectangle's width/height
  (and a circle's radius) are now edited in **mm** (a fraction of the board's real
  dimensions) instead of an opaque 0–1 fraction — so entering equal w/h gives a true
  square. Falls back to the raw fraction when the part has no board dimensions.
- **Opening the full Board Viewer from the mini board panel.** Its open button left
  the full viewer blank ("Open a Python file…") because the active file was never
  relayed to it — the main window now starts streaming the file whenever the board
  window opens via **any** path (toolbar or mini board), not just the toolbar.
- **Breadboard layout fixes for rotated parts (#180).** A rotated part's silk/pin
  text is no longer ever upside down (text is counter-rotated to stay readable),
  its title now sits centred above the rotated body, and **pin labels are a
  consistent size across parts** (they're no longer scaled by each part's
  real-world size).
- **The mini board view is always dark (#181).** Its node labels were invisible in
  light themes; the mini board now uses a fixed dark palette regardless of the app
  theme.

### Added
- **Name & describe your project on the board (#179).** The Board Viewer now has an
  inline-editable **project/robot name + description** above the parts list, saved
  into `robot.yml`. Empty fields show ghost placeholder text; pressing **Enter** (or
  clicking away) saves and flashes a "Saved to robot.yml" confirmation, and **Esc**
  reverts.
- **Resize shapes with drag handles in the Part Editor (#175).** Select a rectangle
  or circle component and drag its handles to resize — rectangles have 8 handles
  (corners + edge midpoints) for width/height, circles have 4 for the diameter. The
  dynamic alignment guides snap the resized edges to nearby pins, holes and other
  shapes (hold **Ctrl/Cmd** to resize freely). Polygons keep their vertex handles.
- **Rotate, rename & delete parts on the breadboard (#176).** Click a placed part
  in the Breadboard view to select it; a small toolbar appears above it to **rotate
  it 90° at a time** (its wires follow the rotated pins), **rename** it (a display-only
  alias — the part's properties are untouched), or **delete** it from the breadboard.
  The rotation is saved in `robot.yml`.

### Fixed
- **Breadboard parts are drawn to real-world scale.** Placed parts on the
  Breadboard view are now sized from their **real dimensions** (mm) relative to the
  board — instead of every part being fitted to one fixed footprint — so e.g. an
  HC-SR04 reads larger than a small sensor. Each part body is also rendered at a
  native size then uniformly scaled, so its **silk text, pads and strokes shrink
  with the body** (a part's added text no longer looks oversized on the breadboard).

### Added
- **Holes are drilled right through the board (#171).** Mounting holes, pin holes
  and castellation half-holes now cut through the PCB **and** the board image **and**
  the copper pad, so the real background shows through them — a much more realistic
  board. Only the holes are cut, never the copper around them. Applies in both the
  Part Editor and the read-only board/preview renderer.
- **Reopens your last folder on launch (#177).** Snakie remembers the working
  folder you last opened and restores it on the next start (if it still exists),
  so you don't have to re-open your project every session.
- **Zoom controls on the board viewer's Breadboard & Schematic views (#174).** The
  life-like Breadboard and Schematic views now have the same floating **− / % / +
  / fit** zoom cluster as the node-graph view and the Part Editor (previously they
  had only mouse-wheel zoom and a single "Fit" button), so all three board views
  share one consistent zoom UI.
- **Duplicate a part in the Parts Library.** The part-detail card has a
  **Duplicate** action that copies the selected part (with a fresh, unique id +
  "… copy" name) into the same library and opens the copy in the Part Editor — the
  quick way to spin up a near-identical board (e.g. the Pico family) without
  redrawing it.
- **Icon part actions + a Reload button.** The part-detail **Edit / Duplicate /
  Promote / Delete** actions are now compact icon buttons (with tooltips +
  accessible labels) instead of text. A new **Reload** button in the Parts toolbar
  re-reads the libraries from disk so on-disk edits show **without restarting the
  app** (it also refreshes the board graph in the same window).
- **Mini board view follows the Board Viewer.** Picking a different board in the
  full Board Viewer now switches the **mini board view** in the main window to the
  same board (relayed across windows), so the two never disagree.
- **Multi-select alignment in the Part Editor (#170).** Drag a marquee to select
  several pins, or **Shift / Ctrl / Cmd-click** to add or remove individual pins
  from the selection (the browser's blue text-highlight no longer appears while
  drag-selecting). A small **alignment toolbar floats just above the last-selected
  pin** and acts on the whole group: align **left / horizontal-centre / right** and
  **top / vertical-centre / bottom**, plus **distribute** horizontally/vertically
  (≥3 pins). The toolbar icons now picture the operation — a reference line with
  three differently-sized bars snapped to it — instead of bare arrows.
- **Smart alignment guides in the Part Editor (#169).** While dragging a pin (or a
  mounting hole), a **green centre-line** appears when it lines up horizontally or
  vertically with another pin/hole, and it **snaps** to that line; hold **Ctrl/Cmd**
  to drag freely without snapping. Holes align with holes, pins with pins.
- **Promote a board to the Standard Boards library (developer).** In a dev build, a
  microcontroller board part shows a **Promote to Standard / Update Standard** button
  in the Parts Library: it copies the board into the bundled `snakie-standard` library
  (runtime copy + the repo copy so it commits and ships). Re-promoting updates it.
- **Author boards in the Part Editor.** A board is just a part with the
  **Microcontroller** family — the Part Editor has a "this part is a microcontroller
  board" toggle (and a family picker) that makes it appear in the Board Viewer's
  board selector. The **Board Creator has been removed** in favour of the
  fuller-featured Part Editor; the board window's "+ board" button now opens the
  Part Editor on a starter Microcontroller part.
- **Boards render as the parts they are.** When a board comes from a Parts Library
  microcontroller part, the Board Viewer's **Breadboard** view now draws it with the
  part's **real appearance** (background image + your exact pin positions +
  castellations) via the part renderer — instead of the generic edge-laid pinout —
  so an authored board looks exactly as drawn. Wiring identity is unchanged (the
  board pad index still matches the part's flattened header order). Legacy built-in
  boards keep the edge-laid rendering.
- **Boards come from the Parts Library now.** The board selector (Board Viewer, the
  mini board view, I²C-detect) is sourced from **microcontroller parts** (`family:
  Microcontroller`) in your installed parts libraries — converted to boards with
  their full pinout — instead of a hardcoded list. A new bundled **Standard Boards**
  library (`examples/parts/snakie-standard`) ships accurate **Raspberry Pi Pico**,
  **Pico 2 W** and **ESP32 DevKit** parts; the old built-in definitions remain only
  as a fresh-install fallback. Same-id boards dedupe to the most complete pinout.
- **Mini board view in the instruments panel (#168).** A compact node-graph board
  sits at the top of the instruments dock, showing the **microcontroller + only the
  pins the current code uses** (auto-zoomed to fit just those pins — no pin table or
  toolbar). A small **expand** button opens the full Board Viewer, and the board
  **auto-swaps to match the REPL boot banner** when it names a known board.
- **Part Editor — stack, reshape, and hide components (#130).** Components (shapes
  + text labels) can be **restacked**: each row in the Components list has ▲/▼
  buttons, and the item at the **top of the list draws on top** (newly-added
  components land on top). The **polygon tool** now lets you **click an edge to add
  a point** (and click a vertex to remove it) — for component polygons *and* the
  board outline. **Pin rotation** is available for **every** pin (not just
  castellated), with a live degree readout — it turns the pin's silk label (and the
  half-hole on castellated pads). And **layer visibility is saved with the part**:
  hide the traced **PCB image** (or any layer) and it stays hidden in the Parts
  Library preview and the Board View while its bytes are kept for later refinement.
- **Robot definition + wiring, merged into the Board View (#128 / #139 / #140).**
  The Board Viewer gains **Breadboard** and **Schematic** view tabs alongside the
  node graph (top-left toggle). The **Breadboard** view draws the chosen
  microcontroller as its **real PCB** (the same accurate pinout the node graph
  uses) and each placed part with its **real Part-Editor appearance** — background
  image + accurate pin positions — wired with **node-RED-style noodles**. The
  **Schematic** view draws each part as its **real schematic symbol** and the MCU
  as a generic **IC block** following standard conventions — **power rails on top,
  a single combined GND at the bottom**, signals on the sides, and **plain pin
  stubs** (no negation-bubble circles). Pads on the same rail collapse to one
  terminal (every `GND`, every `3V3`, …) in Schematic but stay individual in
  Breadboard. Wires are **orthogonal,
  auto-routed** to step around components and keep a margin between parallel runs
  (a Hanan-grid A\* router); Breadboard wires use the same obstacle-avoiding route
  rounded into a noodle, so they **route around parts rather than behind them**.
  Both views **overlay the pins your code uses** (combining the node-graph data
  onto the same canvas) and **auto-zoom-to-fit**. Parts are added from a **slim
  right-side library dock** (collapsible) instead of a separate screen; power wires
  are red, ground white, and signal wires take a palette colour (or one you pick
  per wire). Every wire is mirrored in a **connections table** beneath the canvas.
  The whole project — chosen board, placed parts + placements, and the pin-to-pin
  connections — is saved as a human-readable **`robot.yml`** in the project folder
  (round-trips). Switching views never breaks a wire (index-based pin identity).
  See `docs/robot-definition.md`.
- **Part Editor — fast, accurate pin placement (#130).** Select a pin to get a
  faint **ghost array** (a 2.54 mm cross, four each way): drag a nearby pin and it
  **snaps to that grid**, or drag *from* the selected pin to **lay down a whole row
  of evenly-spaced pins** in one gesture. **Multi-select** pins (rubber-band drag
  or shift-click) to get an **alignment toolbar** — align left / right / top /
  bottom and distribute horizontally / vertically. Castellated pads are redrawn
  **Raspberry-Pi-style** — a **gold** pad with the **main hole centred on the pin**
  and a plated **half-hole** at the board edge (ground pads square, others
  rounded); the half-hole defaults to the nearer left/right edge and a pin's
  **rotate / flip** icons aim it any of the four ways. A **Background** colour well
  sets the PCB colour. Hovering a pin (in the Part Editor **and** the Board
  Viewer's Breadboard) shows **capability badges** (GPIO / PWM / ADC / I²C / SPI /
  UART) in pastel colours. Each layer now has a **padlock** beside its eye — lock a
  layer (e.g. the **PCB / background image**) and its items can't be selected,
  moved, resized, or created, so you can't nudge it out of place while wiring.
- **I²C-detect: pick the bus + pins (#165).** The instrument now has **Bus / SDA /
  SCL** dropdowns of the connected board's valid I²C pins (the RP2040/RP2350
  mapping — invalid combinations can't be chosen), and SCAN runs a one-shot probe
  on those exact pins (no running program needed).
- **Link a MicroPython library to a part (#166).** A part can carry a **Code
  library** — its import **module** name, a **library URL** (mip/git) and a
  **docs/README URL** (authored in the Part Editor). The Parts Library shows the
  module + a docs link, and adding the part to a project offers to **install the
  library onto the connected board** (via `mip`). And when you **connect a board or
  open a `.py` file**, a banner flags any linked library the file doesn't `import`
  and/or the board doesn't have — with a one-click **install** of the missing
  on-board libraries.
- **Parts Library — portable, community-authored & version-controlled (#129).**
  A new **Parts** view (in the Board Viewer — see below) browses your installed
  parts libraries and the parts inside them. Parts are **no longer hard-coded** into Snakie:
  each part lives in its own folder as a human-readable `parts.yml` (+ image
  asset), grouped into libraries (modelled on Fusion 360's electronics
  libraries) under `<userData>/parts/<library>/<part>/`. Search across every part
  by name / tag / family, drill into a part's **footprint + pinout table +
  metadata**, and manage **community libraries from a master registry**
  (browse → install via `git clone` → one-click **update** when a newer version
  is published). Versioning is SemVer; Snakie flags installed libraries that have
  a newer registry version. See `docs/parts-library.md`.
- **Part Editor — author parts (schematic, breadboard, parts.yml) (#130).** A
  full-screen visual editor (launched from the Parts view's **+ New part** or a
  part's **Edit**) authors the exact `parts.yml` the library stores. Flip between
  a **Schematic** view (a line-drawing symbol with the pads ↔ pins table) and an
  interactive **Breadboard** canvas managed from a **Layers panel** (top →
  bottom): **Components** (rectangles + text) → **Pins** → **Mounting holes** →
  **PCB**. The board **image sits on the PCB layer, clipped to the outline**;
  **mounting holes cut through** the PCB *and* the image, and you **can't drop a
  pin inside a hole**. The board outline is a **rectangle** (corner radius) or a
  **polygon**; every pin/hole/component is **free-placed** by dragging. Each layer
  has a visibility toggle (hide the PCB image → footprint view) and a
  **collapsible list of its items**. The properties live in a slim **right-hand
  panel** so the canvas dominates; an **icon toolbar** (Select · Pan · Fit · a
  **Shapes** dropdown · Text) plus an in-canvas **zoom control** drive it.
  Components are coloured **shapes** — **rectangle / circle / polygon** — with
  **fill / outline colour + outline width** wells; pins choose a **pad shape**
  (**square · round · castellated · header hole**); pin **silk labels** read like
  the node-graph board — light-grey text on a transparent background, pushed
  **outward** from the edge each pin sits on (turned 90° on the top/bottom edges so
  dense rows don't overlap). A contextual inspector edits
  the selected object (pin number / GPIO name / type pwr·gnd·io / IO capabilities
  digital·pwm·adc·spi·i2c), **board dimensions** are fields (and **reshape the
  PCB** live), with **Details at the top** of the panel. The view control
  (bottom-right of the canvas) carries zoom + the **grid / snap** toggles (the
  grid draws at the pin spacing); the image layer has a **Lock aspect ratio**
  toggle so the photo isn't stretched; and **clicking a polygon vertex deletes
  it** (drag still moves it; ≥ 3 points kept). The YAML round-trips, so a saved
  part re-opens unchanged. The Parts Library + Part Editor live in the **Board
  Viewer** window (open the board view, then the **chip** button in its title
  bar) — the only place that uses them; parts you create go to your own **My
  Parts** library (listed first, badged
  *Your library*, and shown as the editor's "Saved to" target). See
  `docs/part-editor.md`. (Image **crop** + magic-wand background removal are the
  next pass.)
- **Board/part images render under the locked-down CSP.** Added `img-src 'self'
  data:` to the renderer Content-Security-Policy so `data:`-URL images (the Part
  Editor's board photo and the Board View's uploaded board image) actually paint —
  previously they were silently blocked by the `default-src 'self'` fallback.

### Changed
- **Part Editor: PCB and image toggle independently; board layers moved down.** The
  **PCB body** (outline + fill) now has its **own show/hide toggle, separate from the
  board photo** — so a board-less part (e.g. a motor) can hide the PCB while keeping
  an image, or vice versa (persisted with the part). The **Mounting holes / PCB /
  Image** sections now sit **below the selected-item details** in the right panel, so
  pin editing stays near the top.
- **The Board View is a normal window** now (no longer always-on-top), so it can
  sit behind the editor like any other window.
- **Schematic symbols are balanced & roomier.** Signal pins now split **evenly
  across the left and right sides** of the IC block (instead of piling into one tall
  column), and pin rows use a generous per-pin pitch (the built-in Pico is the
  guide) so labels on the top/bottom rows no longer overlap.
- **Pin labels match the node-graph board everywhere.** In the Breadboard view and
  the Part Editor, pin labels are now light-grey silk text on a transparent
  background, pushed **outward** from the board edge a pin sits on; labels on
  top/bottom-edge pins are turned 90° (never upside-down) so the board title stays
  legible above them.

### Fixed
- **Pin labels always render outside the part.** A pin set in from the board edge
  used to print its silk label over the artwork; labels are now pushed out to the
  board-box edge the pin's **rotation** points to (right/left/top/bottom), keeping
  the perpendicular coordinate at the pin so it still lines up with its row/column.
  Applies in both the Part Editor canvas and the read-only board/preview renderer.
- **"+ board" no longer silently overwrites an existing board.** The new-board
  starter is now treated as a genuinely new part, so the Part Editor's duplicate-id
  guard warns before overwriting (it had been disabled by the pre-seeded id).
- **Schematic view: one terminal per rail, no stray pin circles.** A placed part's
  (or the MCU's) multiple grounds and same-label power pads now collapse to a single
  schematic terminal (they stay individual in Breadboard), and pins draw as plain
  stubs — a circle on a pin means logic inversion, not a connection — so connections
  are just where a wire meets the stub.
- **Board View close button no longer clips when the window is narrowed.** The
  title bar's right-docked controls (ending in the close ✕) are pinned and the
  middle items now shrink/truncate, and the Board View window has a sensible
  minimum size — so the close button is always reachable.

## [0.14.0] - 2026-06-24

### Added
- **Buy me a coffee (#126).** A subtle `☕` link in the status bar opens the
  project's Buy Me a Coffee page; on your first launch a small, dismissible nudge
  appears beside it after a couple of seconds (shown once, never nags again).
- **I²C display (SSD1306) actually drives the panel.** The I²C display instrument
  gained **SDA + SCL pin dropdowns** and an address picker (you couldn't pick the
  pins before), with a **warning when the pins aren't a valid RP2040 I²C pair**
  (I2C0 = GP0/1, 4/5, …; I2C1 = GP2/3, 6/7, …). The board now has a real SSD1306
  driver (`inst.display`, bundled or the `ssd1306` module) so pushing text from
  the panel shows on the screen; plus the buzzer-style live retarget, code-sync
  ("Update code"), and a "Run display demo". (Library 0.5.0.)
- **Ultrasonic rangefinder (HC-SR04) for the Range instrument.** A real on-device
  driver (`inst.ranger`) triggers the sensor and times the echo into a distance,
  and the Range panel gains **TRIG + ECHO pin dropdowns** that retarget the board
  live (`SNKCMD range pins …`), a **code-mismatch warning with one-click "Update
  code"** (matching the buzzer), and a "Run range demo" fallback — the radar/gauge
  then fills from the live readings. The Board View also surfaces a sensor's
  `*_trig`/`*_echo` pins. (Library 0.4.3.)
- **Online ESP32 firmware in the flasher (#125).** The firmware flasher's
  "Download from MicroPython.org" source now covers **ESP32** boards too (it was
  RP2040/UF2-only). Pick the family / model / variant / version from Thonny's
  curated esptool catalog and Snakie downloads the `.bin` and flashes it via
  esptool at the right per-chip offset (`0x1000` for the classic ESP32, `0x0` for
  the S/C/P series and ESP8266) — the same cascade the Pico UF2 source uses.
- **Buzzer "Paste to code" + pin-mismatch warning.** The Buzzer instrument can now
  **paste the melody you built into your program** — as a `melody = [(freq, ms), …]`
  array with a runnable plain-MicroPython player and a commented Snakie-library
  one-liner (so it works with or without the library). And when the panel's pin
  differs from a `buzzer_pin = …` declared in your open code, a small warning
  offers a one-click **update code to match** (the dial already retargets the
  running board live).
- **Board View shows instrument-library pins.** A pin handed to the instrument
  library — e.g. `inst.start(buzzer_pin=15)` — is now surfaced in the Board View
  (an amber "instrument" pin), so you can see at a glance that a pin is in use by
  an instrument, not just by a direct `Pin(...)`.
- **Resizable file-panel split (#124).** The boundary between the **Local files**
  and **Device files** trees is now a draggable splitter — drag it to give the
  device files more room (they used to be capped at a fixed fraction of the
  height). The split position is remembered across sessions.
- **One-click library updates.** The instrument library now carries a
  `__version__`, and the install banner detects when the copy on your board is
  **older than the one Snakie bundles** — offering **Update library** (previously
  it only noticed a *missing* library, so a board with an out-of-date copy silently
  ran old code). This is how you pick up new device features like the buzzer
  receiver and scanners.
- **Background service on the second core + smarter scanning.** The `snakie`
  library gained `inst.start()`, which runs the control channel and the built-in
  scan triggers (`scan:wifi` / `scan:bt` / `scan:i2c`) **on the board's second
  core** (`_thread`), so a robot's main loop stays responsive while the IDE drives
  a scan, and announces itself to the IDE with a `SNK READY` heartbeat. The
  **Wi-Fi scan** panel now uses that: when a Snakie program is running it drives
  the scan directly; when none is, SCAN offers to **open + run a Wi-Fi demo** in a
  new tab (stopping any running program first) instead of doing nothing.
- **Buzzer plays on the real board + an editable melody and a staff.** The Buzzer
  instrument now actually drives a connected speaker: a device-side `buzzer`
  receiver (`tone` / `seq` / `stop` / `pin`), wired by `inst.start(buzzer_pin=…)`
  and played on the second core, with a one-click **buzzer demo** when no program
  is running. The melody row is now editable — **drag notes to reorder, click to
  remove, and insert rests** — and a new **musical-staff row** shows the melody
  and highlights the playing note when you press Play.
- **Dock-to-side on every instrument.** All the new dock instruments (Wi-Fi scan,
  Button, IMU, buzzer, …) now have an **undock key** in their title bar and float
  freely over the window, like the oscilloscope and multimeter already did.
- **Robotics instrument dock (#119).** The instrument dock grew from 3 to a full
  set of instruments, organised so it stays usable: icon-only toggles grouped into
  **Inputs** and **Outputs**, an **in-use vs available** distinction (instruments
  your code declares are surfaced prominently), and an **“＋ Add instrument”
  palette** so every instrument is reachable in a couple of clicks without
  crowding the header. A single registry drives the dock, the toggles and the
  palette.
- **Bidirectional control channel + library toolkit (#115, #116).** Alongside the
  read-only `SNK …` telemetry (#107), the IDE can now **write** to a running
  program over a compact `SNKCMD …` control line (`device.sendControl`). The
  `micropython/instruments.py` library gained matching emitters (IMU, distance,
  button, encoder, screen) and scanners (I²C / Wi-Fi / Bluetooth) plus receivers
  (`teleop`, `buzzer`, `led`, `screen`) and a non-blocking `control` poll helper —
  the foundation the panels below build on.
- **Teleop / gamepad panel (#110).** Drive a robot live from a USB/Bluetooth
  **gamepad** (or on-screen sticks/sliders), with a mapping editor
  (scale / deadzone / invert / trim per output) and safety: a **deadman**
  (hold-to-drive), a big **E-STOP**, and connection-loss → stop.
- **IMU 3D orientation viewer (#111).** A live 3-D model rotates from roll/pitch/yaw
  or a quaternion, with body axes, a horizon/level indicator and numeric RPY
  (lightweight CSS-3D — no new dependencies).
- **Distance-sensor radar (#112).** A range gauge + rolling history for a fixed
  sensor, and a polar **radar sweep** (distance vs angle, fading trails) for a
  servo-swept one — with units, max-range and a proximity-alert threshold.
- **Buzzer / music player (#113).** A piano keyboard, a melody sequencer and
  **RTTTL** ringtone playback for a PWM buzzer, with tempo/volume, a Stop, and
  export to runnable MicroPython.
- **Button & LED panels (#114).** Watch input pins (pressed/released + edge
  counters) and drive outputs from the UI — digital, **PWM brightness**, an **RGB**
  colour picker, and a **NeoPixel/WS2812** strip.
- **Rotary encoder panel (#117).** A knurled dial turns live to the encoder count,
  with direction (CW/CCW), optional RPM and the push-switch state.
- **I²C display mirror & output (#118).** A skeuomorphic OLED/LCD module that
  **mirrors** the device’s framebuffer/text live, or lets you **push** text to the
  real display — SSD1306 / SH1106 and HD44780 character LCDs.
- **Scanner instruments (#121).** On-demand **I²C detect** (the classic 8×16
  address grid), **Wi-Fi scan** (signal-bar network list) and **Bluetooth scan**
  (BLE device list), each triggered by a SCAN button over the control channel.
- **Modular per-component module installs (#120).** A **Modules** manager (in the
  Packages view) installs only the device drivers a robot actually uses
  (ssd1306/sh1106, hcsr04/vl53l0x, mpu6050/bno055/lsm6ds, neopixel, …), mapped to
  the instrument each one powers, with installed-vs-available state.
- **File-panel buttons (#104, #105).** Refresh buttons on both the local and device
  file trees, a **new-folder** button on the device tree, and the upload/download
  transfer controls reduced to clear icon-only buttons.

### Changed
- **More accurate board representations (#109).** The built-in board pinouts were
  redrawn to match the real boards: the **Pimoroni Tiny 2040 / 2350** now have their
  pins running **vertically** (left/right edges), the USB connector / MCU / Wi-Fi /
  onboard-LED features sit at their real positions, the **noodle wires are shorter**
  so the pin labels sit close to the board, and pad labels are placed on the correct
  side (left-edge pads labelled left, right-edge labelled right). Pinouts are
  best-effort from documented sources — verify against the datasheets if precision
  matters.

### Fixed
- **The Bluetooth scanner actually scans.** `bt_scan()` was a stub that returned
  nothing, so the panel's SCAN did nothing. It now runs a real active BLE
  `gap_scan` (IRQ-collected, names decoded from the advertising data) and emits
  each device, so the Bluetooth instrument lists nearby devices like the Wi-Fi
  one does. (Library 0.4.2.)
- **Buzzer tempo / octave / volume are now live, and reach the speaker.** The
  VOLUME slider now sets the board's PWM **duty** (a `vol` control command) — not
  just the IDE preview — and OCTAVE (transpose) + TEMPO (time-scale) are applied
  at **playback** so they change an already-built melody on both the IDE preview
  and the device. ▶ Play also re-targets the selected pin + volume before sending
  the notes. (Library 0.4.1.)
- **Board View shows a pin the instrument library uses even via a constant.** It
  now detects `BUZZER_PIN = 0` (and any `*_PIN = <int>`) that a program passes to
  `inst.start(...)` by name — the demo pattern — not only literal kwargs.
- **The buzzer plays reliably and the board no longer wedges.** The control
  channel now runs on the **main loop** (`inst.control.poll()`), not a second-core
  thread — the old `_thread` polled `stdin` with a blocking 64-byte read that could
  hang core 1 and wedge the Pico on Stop/soft-reset (needing a replug). `poll()`
  reads one byte at a time (never blocks) and emits the `SNK READY` heartbeat, and
  `start()` defaults to main-loop polling (the second-core mode is now an
  experimental opt-in). The Buzzer panel's ▶ Play always sounds the **local
  preview** even when no board program is running, "Run buzzer demo" uses the
  pin you've selected, and the demos poll + stop cleanly. Library bumped to 0.4.0.
- **Instrument panels no longer spam the REPL or leave a thread running.** The
  panels now only write `SNKCMD` control lines when a Snakie program is actually
  running and servicing the channel — previously the buzzer keyboard / STOP / pin
  controls and the presence probe could write to a bare REPL, which echoed back as
  a stream of `SyntaxError`s. The bundled demos now stop the **second-core service
  cleanly** when you press Stop (`inst.stop()` on `KeyboardInterrupt`), and
  `inst.stop()` silences the buzzer and aborts an in-progress melody.

## [0.13.0] - 2026-06-23

### Added
- **One-click install of the instruments library (#108).** When you open the
  instruments and a connected board doesn't already have `instruments.py`, a manila
  banner appears at the top offering **Download & install** — it writes the library
  to `/lib/instruments.py` on the device. The banner is closable but reappears if
  you close and reopen the instrument panel, and never shows once the library is
  installed (the check is cached per connection).

## [0.12.0] - 2026-06-23

### Added
- **MicroPython instruments library + live telemetry (#107).** A new
  `micropython/instruments.py` lets a running program emit readings with simple
  commands — `scope(value)`, `meter(value)`, `plot(temp=21.4, …)`, plus
  `read_adc(adc)` / `read_pwm(pwm)` convenience. The IDE parses these printed
  readings **passively from the serial stream**, so the Oscilloscope (live sampled
  waveform), Multimeter (value + min/max/avg) and Plotter update **inside a running
  loop with no REPL interruption** — the telemetry lines are hidden from the console.
  See `docs/instruments-library.md`. (The REPL-poll LIVE toggle remains the fallback
  for programs that don't print telemetry.)

## [0.11.0] - 2026-06-21

### Changed
- **Instruments now live in the main window.** The Oscilloscope, Multimeter and
  Plotter moved out of the Board View window into the main editor window. They open
  as **draggable windows that float above the whole window**, or dock into an
  **INSTRUMENT DOCK** rail to the right of the chat panel — toggled by an
  **Instruments** button in the toolbar (grouped with the panel toggles, in panel
  order). The dock header's **SCOPE / METER / PLOT** buttons summon and show/hide
  each instrument; opening a scope/meter from a Board-View PWM/ADC node also docks
  it there, and closing one hides it back into the dock. The Plotter moved from the
  shell into the dock (the shell is now Console / Problems). The dock is independent
  of the chat panel.
- **Stop button doubles as Reset.** Pressing Stop interrupts a running program
  (Ctrl-C), or — when nothing is running — soft-resets the board (Ctrl-D); the
  button shows **Stop** or **Reset** accordingly.

### Added
- **Instrument LIVE toggle.** The Oscilloscope and Multimeter have a **LIVE** toggle
  (default **off**) that gates device polling, so opening an instrument no longer
  interrupts a running program by surprise — they show static/parsed readings until
  you turn LIVE on, at which point the **status bar warns** that polling is
  interrupting the board and offers a one-click **Stop**.

### Fixed
- **Console no longer shows internal probe traffic.** Live-value polling runs over
  the raw REPL; that machine traffic (`<<SNKV>>…` probes, raw-REPL banners and
  interrupts) is no longer broadcast to the terminal — your typing and Run output
  still stream through.

## [0.10.0] - 2026-06-20

### Added
- **Plotter alongside the console (#103).** The serial Plotter is now a toggle in
  the Shell header that splits the dock to show the live chart **next to** the
  console (instead of replacing it), reskinned as a skeuomorphic blue-phosphor
  strip-chart — scrolling traces with a live-edge cursor, a series legend, a
  `samples · Hz` readout and a single CLEAR key.
- **Oscilloscope instrument (#101).** PWM nodes in the Board View gain a scope
  launcher that opens a skeuomorphic CRT oscilloscope rendering the pin's square
  wave from its frequency + duty (FREQ / DUTY / PERIOD readouts, live duty when
  connected). Opens docked beside the board on wide windows, overlaid on narrow.
- **Multimeter instrument (#102).** ADC pins (`ADC(Pin(26))` …, a new parsed type)
  gain a meter launcher that opens a skeuomorphic handheld DMM showing the live
  voltage on a 7-segment display, with raw count, a 0–3.3 V bargraph and MIN/MAX/AVG.
- **Board View live pin values (#97).** A **LIVE** toggle in the board view header
  (off by default) reads the connected board over the REPL and shows each node's
  real value — `1`/`0` for digital (green when asserted), PWM duty, and an activity
  indicator for I²C/SPI/PIO — falling back to idle when disconnected. It is opt-in
  because reading values interrupts a running program.
- **Board View viewport controls (#99).** A floating control cluster on the board
  canvas: **zoom in / out**, **zoom to fit**, a **100%** button that toggles between
  fit and 1:1, and **export** of the current view as **SVG, PNG or PDF**.
- **Board View rotate (#96).** A rotate button cycles the board view 90° clockwise;
  pad/label text always stays legible (rendered at 0° or 90° CW, never upside down),
  so a header that becomes horizontal reads correctly.

### Fixed
- **Board View draws the full physical pinout.** The board view now renders the
  selected board's complete pinout (every pad from its definition, at its real
  edge position) and redraws when you switch board type — previously it only drew
  the pins in use and barely changed on a board switch. Connections wire to their
  actual pads. (Shared board-layout extracted to one tested module.)
- **Find & Replace draggable by the whole title bar (#98).** The dialog can be
  dragged from anywhere along its top row, not just the textured grip.

### Changed
- **Board View node-graph.** The live Board View is redesigned as a **node graph**:
  one node per declared connection — a colour-coded type tag (`IN`/`OUT`/`I²C`/
  `PWM`/`SPI`/`PIO`) inline beside the variable, with a value readout — each wired
  by a drooping cable to its GPIO pad on the board's left edge, aligned row-for-row.
  The `PINS IN USE` table moves below it. (Node values are placeholders for now;
  live device values are tracked in #97.) The Board Creator's preview is unchanged.

## [0.9.0] - 2026-06-20

### Fixed
- **Board View now shows on open.** A freshly-opened Board View window could stay
  blank when a program with `Pin` assignments was already loaded — the active-file
  snapshot was relayed before the window had subscribed to it, so nothing drew.
  The window now pulls the latest snapshot on mount (and still updates live as you
  edit).
- **Editor sticky scroll disabled.** The pinned scope/function header that stuck to
  the top of the editor overlapped and clashed with the code beneath it, so it is
  now turned off.
- **Find & Replace dialog (#95).** Replace is now reachable from find-only mode
  via a chevron that reveals/hides the Replace row (previously it only appeared
  when opened with Cmd/Ctrl-H), removed the duplicate prev/next controls (the
  Up/Down direction radio + extra Find button that duplicated the ↑/↓ arrows), and
  kept a clear ✕ close button in the title bar.

### Changed
- **Toolbar layout.** The Settings, Board View and light/dark-mode knobs now sit
  beside the Run/Stop buttons; the Files/Shell/Chat panel-collapse knobs stay
  aligned to the right.
- **Board View v2.** The Board View is now its own **floating window** (a real
  always-on-top window fed the active file live over IPC) instead of a modal
  dialog, and it labels each wired pin by **connection type** — `output`, `input`,
  `pwm`, `i2c`, `spi` or `pio` — instead of guessing a peripheral. `Pin` direction
  is read from `Pin.OUT`/`Pin.IN` (and inferred from `.on()`/`.value()` usage when
  undirected). It is now **multi-board**: a selector switches between built-in
  definitions for the Raspberry Pi Pico 2 W, ESP32 DevKit, Pimoroni Pico Plus 2,
  Tiny 2040 and Tiny 2350, drawn from a generic, data-driven renderer.

### Added
- **Board Creator (#94).** A visual editor for custom boards, entered from a brass
  knob button in the Board View: set the board name, chip type, PCB colour and
  aspect; lay out pin headers along any edge (or single pins), each pad assigned a
  GPIO, name and type (`gpio`/`gnd`/`vcc`/`other`, with power pads drawn
  distinctly); pick an onboard LED; and represent the board with either an uploaded
  image or drawn rectangle features — saved as a round-trippable `BoardDefinition`
  JSON (with a one-way "Export SVG" convenience). Boards are saved to / loaded from
  / deleted in `<userData>/boards/` and become selectable in the Board View.
- **Custom board definitions.** Drop a `BoardDefinition` JSON file into
  `<userData>/boards/` to add your own board to the Board View (a user board
  overrides a built-in with the same `id`); an in-view button opens that folder.
  See `docs/board.md` for the schema and a worked example.

## [0.8.0] - 2026-06-20

### Added
- **Board View popup.** A new editor pop-up that parses the active Python file for
  pin usage (`Pin`, `PWM`, `I2C`, `SPI`, `StateMachine`) and draws a Raspberry Pi
  Pico 2 W / RP2350 board with colour-coded wires from each used GPIO to a
  representative peripheral (LED, SG90 servo, BME280, WS2812, ST7789), plus a
  "pins in use" table listing the bus, pins, variable and constructor. Opens from a
  **Board** button in the toolbar and re-wires live as you edit.

### Changed
- **Packages panel — manila-tag skin (Skeuomorph).** The package manager is
  reskinned as kraft manila tags on green felt (kraft spine, eyelet, version
  rubber-stamp, INSTALL gold key / INSTALLED green stamp), with a live **flash
  usage** readout + meter sourced from the device's `os.statvfs('/')` when
  connected. Search/install behaviour is unchanged.
- **Plugins panel — module-rack skin (Skeuomorph).** The Plugins view is reskinned
  as a eurorack module rack — brushed faceplates with mounting rails, hex screws,
  per-module accent stripe, knob/LED/patch-jack — where **mounted** modules are
  plugins that loaded OK (click to patch in and run their commands) and
  **available** modules are ones that failed to load (gold **GET** retries the
  load). All plugin actions are preserved.
- **Find & Replace polish (Skeuomorph).** The Find & Replace panel (#92) becomes a
  draggable brushed-aluminium floating dialog with **whole-word** and **regex**
  toggles (invalid patterns are guarded, not thrown) and an **N of M matches**
  counter. All existing find/replace behaviour and shortcuts are unchanged.

## [0.7.0] - 2026-06-20

### Added
- **Find & Replace (#92).** A panel for the editor with a **Find** and a
  **Replace with** box, a **case-sensitive** toggle, an **Up/Down** search
  direction (Down by default), and **Find / Replace / Replace+Find / Replace all**
  buttons (Replace-all is a single undo step). Opens with ⌘/Ctrl-F (find) or
  ⌘/Ctrl-H (replace), plus a toolbar button; Esc closes.
- **YAML / JSON validation (#93).** `.json`, `.yml` and `.yaml` files are
  validated as you edit — invalid formats get squiggles and Problems-panel entries
  with the line/column and reason, plus an **autofix** (format/prettify, and
  best-effort JSON comment + trailing-comma repair) offered as a lightbulb
  quick-fix and a Fix/Format button.

### Changed
- **Dark mode is now a dark Skeuomorph (#91).** Toggling to dark gives a cohesive
  dark version of the default skin — dark brushed-metal chrome, brass knobs,
  glossy dark Run/Stop pills, dark green-felt Source Control, a deep-slate
  ruled-paper editor, the recessed green-phosphor console, and a dark metal status
  bar — instead of the old flat NES dark theme. The ruled-paper settings and the
  light⇄dark toggle are unchanged.

## [0.6.3] - 2026-06-19

### Fixed
- **First signed + notarized macOS release.** Getting macOS signing to actually
  run took fixing three release-workflow problems: `CSC_IDENTITY_AUTO_DISCOVERY=false`
  was a kill-switch that *disabled* signing (so signed builds shipped unsigned);
  the signing env leaked into the Windows job (signing the `.exe` with the macOS
  cert, then failing when scoped to an empty string); and notarization needs the
  Apple Team ID, now set in `electron-builder.yml`. The macOS build is now signed
  (Developer ID Application) **and** notarized, so the in-app updater can install
  on macOS (Squirrel.Mac validates the signature) and Gatekeeper no longer flags
  the app as "damaged". No functional changes since 0.6.0. (0.6.1 and 0.6.2 were
  superseded build attempts.)

## [0.6.0] - 2026-06-19

### Added
- **MicroPython firmware catalog in the flash dialog (#64).** The firmware
  flasher can now pull the UF2 firmware catalog (Thonny's curated MicroPython
  list) in the main process and present a **Family → Model → Variant → Version**
  cascade. **Download & Flash** streams the chosen `.uf2` to a temp file and
  flashes it with a live **% progress bar** and a **Done** button. The local-file
  Browse and the ESP/esptool paths are unchanged.
- **Check for Updates (#89).** A native **Check for Updates…** menu item (in the
  app menu on macOS, a Help menu on Windows/Linux) plus a clickable **status-bar
  version** both run the same manual GitHub update check — prompting to download
  when a newer release exists, reporting "up to date" otherwise, and noting that
  updates only apply to installed builds when run unpackaged.
- **Docstrings in the outline (#88).** Hovering a function or class in the
  outline / function inspector now shows its docstring as a tooltip.

### Changed
- **Simplified the local Files panel (#87).** New File / New Folder are now
  icon-only; Rename and Delete moved into the right-click menu; and the Open
  Folder button is replaced by a clickable **path breadcrumb** where each
  ancestor segment re-roots the tree.

### Fixed
- **Update errors stay contained (#90).** A long update/install error (e.g. the
  macOS code-signature validation failure) now wraps inside its box with a short,
  friendly summary (full text on hover) instead of overflowing the notifier and
  status bar, and offers a **Download manually** button to the GitHub releases
  page. (The signature failure itself still requires a properly signed +
  notarized release — see `docs/macos-signing.md`.)

## [0.5.0] - 2026-06-19

### Added
- **In-app LLM provider system (#77).** The Claude chat is now provider-agnostic:
  a main-process registry adds **OpenAI, Google Gemini, Grok (xAI) and GitHub
  Copilot** alongside Anthropic Claude, surfaced as provider / model / effort
  dropdowns at the bottom of the chat with secure per-provider API-key storage.
  Only Anthropic is verified locally; the others are wired to spec and untested
  without credentials.
- **Send console output to chat (#78).** A **Send to chat** button above the
  console (shown when the chat panel is open) plus an **Attach console (since
  last Run)** composer toggle hand the device's REPL output to the assistant
  without copy-paste.
- **AI-first editor (#82).** The chat always sees the up-to-date active file;
  assistant code blocks gain an **Apply** button that writes straight into the
  editor (undoable); and an opt-in **inline autocomplete** (ghost text) suggests
  as you type via a fast, per-provider completion model configured separately
  from the main chat model.
- **GitHub Copilot sign-in.** The Copilot provider authenticates with a GitHub
  **OAuth device-flow** sign-in (approve a code at github.com/login/device) on an
  account with an active Copilot subscription — Snakie exchanges the resulting
  GitHub token for the short-lived Copilot token its chat endpoint requires
  (cached until expiry). A plain personal access token can't reach that endpoint,
  so sign-in is used instead. Experimental — verifiable only against a real
  Copilot account.
- **Editor paper settings (#80, #81).** A new **Settings** dialog (toolbar gear)
  toggles the notebook **ruled lines**, a subtle squared **dots** grid, or
  **off**, and adjusts the **line spacing** (shown live) — persisted across
  launches.
- **Syntax highlighting + editor themes (#84).** Richer Monaco highlighting
  (keywords, strings, numbers, comments and types in distinct colours), a whiter
  off-white paper so the colours read clearly, and an **editor theme** selector
  (Paper / Bright / Midnight) in the Settings → Editor tab, backed by an
  extensible theme table.
- **Tabbed Settings dialog + Chat settings (#83).** The Settings dialog now has
  **Editor** and **Chat** tabs; the chat's title bar is gone and its per-provider
  API keys, the GitHub Copilot sign-in, and the autocomplete settings moved into
  the **Chat** tab (the chat's ⚙ opens it directly).
- **macOS code signing + notarization** wired into the release workflow (#47).
  When the Apple secrets are set (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — see
  `docs/macos-signing.md`), releases are signed (Developer ID, hardened runtime
  + entitlements) and notarized — which is what lets the **in-app updater
  install on macOS** and removes the "damaged" Gatekeeper warning. Builds stay
  unsigned-but-working when the secrets are absent.

### Changed
- **Skeuomorph skin is the new default look.** A photoreal brushed-metal /
  green-felt / cream **ruled-paper** theme: a segmented New/Open/Save control,
  glossy Run/Stop pills, round panel-collapse knobs, a recessed green-phosphor
  console, and a notebook editor whose text sits on ruled lines (transparent
  Monaco over a ruled gradient, with a red margin rule). The toolbar knob flips
  to a dark "lights out" theme.
- **Removed the redundant panel title bars** for Editor, Source Control, Files,
  Packages, Plugins and Inspect (#79) — the activity bar already names the active
  view (Shell and Chat keep their headers, which carry controls).
- **Activity-bar buttons toggle the left panel (#86).** Clicking a view button
  switches to / expands it; clicking the already-active one collapses the left
  panel (click again to re-expand), matching the familiar editor behaviour.

### Fixed
- **Toolbars no longer clip at narrow widths (#85).** The shell-panel header
  controls (Console/Plotter/Problems, Clear, port + connect/disconnect) and the
  device/local file-tree action buttons now wrap instead of being hidden under
  the chat panel when space is tight.

## [0.3.3] - 2026-06-02

### Fixed
- **macOS auto-update (cont.):** the v0.3.2 mac `.zip` was built but not uploaded
  to the release (the CI artifact glob matched `*.blockmap` but not `*.zip`), so
  `latest-mac.yml` referenced a missing file. Upload `dist/*.zip` too.

## [0.3.2] - 2026-06-02

### Fixed
- **macOS auto-update** failed with "ZIP file not provided" — electron-updater
  on macOS downloads a `.zip`, but the mac target only built a `.dmg`. Added a
  `zip` mac target so `latest-mac.yml` references an updatable artifact. (Note:
  the *install* step still needs a signed app on macOS — see #47.)

## [0.3.1] - 2026-06-02

### Added
- Publish a **Linux arm64 AppImage** (built natively), so Raspberry Pi / arm64
  installs can receive in-app updates (#74). (Patch release.)

## [0.3.0] - 2026-06-02

### Added
- **Update notifications + status-bar update button (#74).** When a newer
  release is available the status bar shows an **Update to vX** button (in the
  version slot) — click to **download**, watch progress, then **Restart to
  update** (electron-updater, `autoDownload` off so it's user-initiated); a
  dismissible banner also offers Download. Adds `window.api.updates.download()`
  and an hourly re-check.
- **Python plugin system (MVP, #61).** Snakie spawns the user's `python3` running
  a host that discovers and loads Python plugins and talks to the app over
  JSON-RPC. Plugins use a stdlib-only `snakie` SDK (`@plugin.command`, `Context`,
  `message`/`edit` helpers); discovery from `~/.snakie/plugins/` (+ bundled
  examples and entry points). New **Plugins** activity-bar view lists plugins and
  runs their commands against the active file; graceful "Python not found" state.
  Ships an example plugin + `docs/writing-plugins.md` (design: `docs/plugin-system.md`).
- **Reactive plugins + editor decorations (#69).** Plugins can register a
  `@plugin.linter` that runs automatically as you type (debounced) and on open,
  drawing **squiggle underlines** (Monaco markers) and offering **lightbulb
  quick-fixes** (a Monaco code-action provider applies the plugin's edit). Adds a
  `lint` RPC / `window.api.plugins.lint`, diagnostics with optional ranged
  `fixes`, and an example linter (flags trailing whitespace + TODOs).
- **Python linter plugin (#65).** A bundled `python_linter` plugin runs **ruff**
  (with autofix quick-fixes) or falls back to **pyflakes**, linting `.py` files
  live via the reactive engine. New **Problems** tab in the shell panel (count
  badge, click-to-jump) backed by a shared diagnostics store, and a persisted
  **Lint on/off** toggle. Graceful when no linter is installed (`pip install ruff`).
- **Toolbar file actions:** New File, Open Folder and Save icon buttons (left of
  Run). Save also works via Ctrl/Cmd-S, with a native **Save As** dialog for
  untitled buffers. The opened folder is now the app's shared working directory,
  so both the toolbar and the Files panel drive it.

### Fixed
- **Source Control now follows the open working folder.** It was always showing
  "Open a folder to manage it with Git" even after a folder was chosen in Files;
  it now points the Git service at the shared `currentFolder` (auto `openRepo` +
  status) and its "Open Folder" buttons drive the same shared action.
- **File operations did nothing in Electron.** New File / New Folder / Rename
  (in both file trees) and the "Upload to board" path used `window.prompt`,
  which Electron's renderer doesn't implement — replaced with an in-app prompt
  modal so they work.
- **Critical: `window.api` preload bridge never loaded in the real Electron
  app** (only the browser preview "worked"), so Open Folder, package search, the
  serial port list and all device features did nothing. Two causes, both fixed:
  the preload was emitted as `index.js` but `package.json` is `"type": "module"`,
  so Electron's `require()` failed with `ERR_REQUIRE_ESM` — now emitted/loaded as
  `index.cjs`; and `sandbox: true` blocked the CommonJS preload from
  `require()`-ing `@electron-toolkit/preload` — now `sandbox: false`
  (`contextIsolation` + `nodeIntegration: false` kept). The renderer fallback
  also now logs a loud error if the bridge is missing inside Electron rather than
  silently masking it.
- **Editor matched the app theme:** the Monaco editor no longer shows a light
  background in dark mode. It reads the app's `data-theme` (via a MutationObserver,
  so it can't desync) and uses a custom dark theme whose background matches the
  NES palette (`#14141f`).
- Removed the duplicated "Device files" heading in the device panel's
  empty state (the section header already names it).

### Changed
- **Retro 8-bit UI overhaul.** New look & feel: NES-inspired dark theme
  (slate + blue/red/green/yellow accents), a single readable **JetBrains Mono**
  font across the whole UI, square corners and chunky pixel buttons — the 8-bit
  feel comes from the palette/buttons/borders, not the font. Dark is the default.
- **Left activity bar + view switching.** A vertical icon strip on the far
  left switches the left sidebar between **Files**, **Source Control**,
  **Packages**, **Inspect** (Outline + Variables in a vertical split), and
  **Help**. Source Control / Packages / Outline / Variables / Help moved out of
  the right pane. The center editor is unchanged.
- **Right pane is now Chat-only**; the toolbar toggle is relabelled
  "Panel" → "Chat". Toolbar Run/Stop/Flash and the shell Clear button are
  sized consistently with the other toolbar buttons.

## [0.2.0] - 2026-06-01

### Added
- Drafted a placeholder Snakie app logo — a snake coiled into an "S" on a green
  squircle (`build/icon.png`, editable source `build/icon.svg`). (#46)
- Build target added: macOS Intel (x64) dmg, alongside the existing macOS
  arm64, Linux x64 and Windows x64 installers. (#49) (Linux arm64 was attempted
  but deferred — see #53 — due to electron-builder's x86 `fpm`/`-m64` issues.)
- Unit tests (vitest) for the pure parsing logic — code outline, device
  variables, and serial-plotter line parsing (39 tests); `npm test` and a CI
  test step. Plus `docs/hardware-test-plan.md`, a manual on-device checklist.
  (toward #45)

### Changed
- Renderer startup payload cut ~88% (~7.4 MB → ~0.9 MB): Monaco is now
  code-split and lazy-loaded only when a file is opened, and the unused JSON
  language service was dropped (`.json` opens as plain text). (#48)

### Fixed
- Renderer no longer blank-screens when the Electron preload bridge
  (`window.api` / `window.electron`) is unavailable — e.g. a browser preview or
  a failed preload. A no-op fallback bridge is installed before render so the UI
  degrades gracefully to a "disconnected / empty" state (with a console
  warning). No effect inside Electron, where the real bridge is present.

## [0.1.0] - 2026-06-01

First public build — a cross-platform (Windows / macOS / Linux) Electron
MicroPython editor.

### Added
- **Editor:** Monaco editor with Python syntax, MicroPython-aware autocomplete,
  tabbed multi-file editing (with a `+` new-tab button), and Ctrl/Cmd-S save.
- **Files:** local and on-device file browsers with right-click context menus;
  create / rename / delete on both; upload-to-board / download-to-computer
  controls between the panes.
- **Device:** serial connection layer speaking the MicroPython raw-REPL
  protocol; interactive xterm REPL with connect / port-select / status; Run,
  Stop and Clear-shell controls; a serial plotter for numeric console output.
- **Right pane (tabbed):** in-app Help & MicroPython reference, code Outline,
  device Variables inspector, Claude LLM chat, and a `mip`/PyPI package
  installer with discovery.
- **Tools:** in-app MicroPython firmware flashing (esptool for ESP, UF2 copy for
  RP2040); built-in Git source control (status / stage / commit / diff /
  branch / push / pull); update notifications via electron-updater.
- **Shell:** resizable, collapsible panels with a light/dark theme.
- **Packaging:** electron-builder installers (Windows NSIS, macOS dmg, Linux
  AppImage + deb) built and published to GitHub Releases by a tag-triggered CI
  workflow.

### Known limitations
- Device, serial, firmware and on-device package-install paths are
  build/type-verified but not yet validated against real hardware.
- The LLM chat requires an Anthropic API key; the package installer requires
  network access.
- Placeholder app icon; code signing not yet configured.

[Unreleased]: https://github.com/kevinmcaleer/Snakie/compare/v0.24.0...HEAD
[0.24.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.23.2...v0.24.0
[0.23.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.23.1...v0.23.2
[0.23.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.23.0...v0.23.1
[0.23.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.3...v0.21.0
[0.20.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.1...v0.20.2
[0.20.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.6.0...v0.6.3
[0.6.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.3...v0.5.0
[0.3.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kevinmcaleer/Snakie/releases/tag/v0.1.0
