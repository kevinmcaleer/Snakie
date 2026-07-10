<!--
  Snakie — "Robot Mode" homepage section (work in progress / nearly ready).
  Drop this straight into the kevsrobots.com Snakie page.
  The fenced ```mermaid block renders natively wherever Mermaid is enabled
  (Jekyll + mermaid.js, GitHub, most static-site setups). If your site doesn't
  render Mermaid, use the self-contained snakie-robot-workflow.html preview instead.
-->

## Simulate a whole robot — without the robot

**Coming soon to Snakie.** Design the circuit, write the code, print the parts,
then watch your MicroPython *drive a 3D model of the robot* — all in one app,
before a single wire is soldered.

Snakie already parses your code to draw your board and run live instruments.
**Robot Mode** takes it the whole way: add servos, import your printed STLs, link
them into a kinematic chain, and press play. The model moves exactly as your code
tells the real servos to — a full virtual test bench on your desktop.

And because everything lives in one project folder, the project **documents
itself**: a schematic, a breadboard wiring image with a pinout table, the code,
and the 3D model all stay in sync.

```mermaid
flowchart LR
  %% ============ DESIGN & WIRE (Board View) ============
  subgraph BENCH["🛠️ &nbsp;Design and wire — Board View"]
    direction TB
    A["✍️ &nbsp;Write MicroPython<br/>in the editor"]
    B["🔌 &nbsp;Add components<br/>to the breadboard"]
    C["⚙️ &nbsp;Load part drivers"]
    A --> B --> C
  end

  %% ============ ROBOT MODE ============
  subgraph ROBOT["🤖 &nbsp;Robot Mode"]
    direction TB
    D["🦾 &nbsp;Add servos"]
    E["🧭 &nbsp;Map each servo<br/>to your code"]
    F["📦 &nbsp;Import STL meshes"]
    G["🔗 &nbsp;Link STLs into an<br/>IK chain (URDF joints)"]
    H["▶️ &nbsp;Simulate movement<br/>from your code"]
    D --> E --> F --> G --> H
  end

  C ==>|enter Robot Mode| D

  %% ============ SELF-DOCUMENTING OUTPUTS ============
  subgraph DOCS["📚 &nbsp;The project documents itself"]
    direction TB
    S["📐 &nbsp;Schematic"]
    W["🍞 &nbsp;Breadboard image<br/>+ pinout table"]
    K["🐍 &nbsp;MicroPython code"]
    M["🧊 &nbsp;3D model"]
  end

  C -.-> S
  C -.-> W
  A -.-> K
  G -.-> M

  H --> DONE(["✅ &nbsp;A complete robot,<br/>simulated in a virtual<br/>environment — all inside Snakie"])

  %% ============ STYLING ============
  classDef bench fill:#12352b,stroke:#37884a,stroke-width:1.5px,color:#e8f5ee;
  classDef robot fill:#1b2a3a,stroke:#4ea1ff,stroke-width:1.5px,color:#eaf3ff;
  classDef docs fill:#2a2416,stroke:#b8892b,stroke-width:1.5px,color:#f6ecd6;
  classDef done fill:#0f5132,stroke:#3ddc84,stroke-width:2px,color:#eafff3;

  class A,B,C bench;
  class D,E,F,G,H robot;
  class S,W,K,M docs;
  class DONE done;
```

> **Where it stands:** Robot Mode is a work in progress and nearly ready to
> share — the Board View, wiring/pinout docs and live instruments ship today;
> the STL import, IK chain and code-driven simulation are landing next.
