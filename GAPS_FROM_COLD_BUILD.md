# Gaps found during the cold-build exercise

A running log from the "aspiring BAS tech builds a site from an empty canvas
with a guide" dogfooding session (2026-06-09). The premise: a novice who knows
nothing builds Suite 200 (1 RTU + economizer, 3 VAVs w/ hydronic reheat) step
by step, and we record every place the tool assumes knowledge, confuses, or
can't do the realistic thing. These are learning-experience opportunities, not
bugs.

Severity: **P1** = blocks/teaches wrong · **P2** = real friction · **P3** = polish.

---

## Step 1 — Pick a supervisor / engine

The model picker is a "pick by spec" UI — great once you know the specs, opaque
to a beginner.

- **G1 (P1) — No guidance on how to choose.** Nine boxes, each with a
  programming-language badge, a point count, and a protocol list. A green tech
  has no basis to choose between them. There's no "new here? start with this,"
  no per-field explanation, no recommended default. The selection moment is the
  first place a novice stalls.
- **G2 (P2) — "pts" is unexplained.** "5000 pts · 5000 via expansion" means
  nothing to a beginner. What's a point? Is my site 50 or 5000? No tooltip, no
  sizing hint ("a typical VAV is ~8 points").
- **G3 (P1) — The protocol distinction is invisible exactly when it matters
  most.** BACnet/IP vs MS/TP is the core thing this whole network track is
  meant to teach, yet at selection time it's just an unexplained comma list.
  No "which protocols does my site need?" hint, no filter ("I have MS/TP field
  controllers"). A beginner can pick a supervisor that can't speak to their
  field bus and not find out until much later.
- **G4 (P3) — No cost/price signal.** Network gear tiles carry a `$`/`$$`/`$$$`
  band; supervisors and controllers don't. Inconsistent, and estimators/techs
  do think about box cost.
- **G5 (P3) — No physical/power/mounting info.** DIN rail vs panel, 24VAC vs
  PoE, port count. Commissioning-relevant and absent.
- **G6 (P3) — Redundant `supervisor` tag** on every row of the supervisor
  picker.

### Candidate fixes (for later triage)
- A short "what am I looking at?" header in the picker + hover explainers on the
  language badge, the pts count, and each protocol.
- A "beginner / most common" star on the JACE 8000 + JCI SNE (the two a new
  tech is most likely to meet).
- Surface the protocol list as the primary decision axis (it's the real
  constraint), maybe with a "needs MS/TP field bus?" toggle.

- **G7 (decision, not a bug) — proprietary programming licensure.** James:
  vendor programming environments (JCI CCT block-graph, Siemens PPCL) sit behind
  licensed software + dongles, so a learner can't actually use them to "set
  things up" — don't push learners down those paths. Nuance to preserve: the
  *hardware* stays useful in the catalog because BACnet commissioning/addressing/
  troubleshooting is vendor-neutral at the wire — a tech really does meet JCI and
  Siemens boxes. **Recommendation:** keep the hardware for topology realism;
  make the open/standard path (IEC-61131-3 ST, or generic) the default for
  anything a learner programs; consider a "proprietary — config shown for
  reference, not editable here" tag on closed environments rather than removing
  the boxes. Needs James's call at triage.

## Step 2 — Give the supervisor a network identity (IP / Mask / GW)

- **G8 (P1) — ✅ FIXED LIVE — IP/Mask/GW fields looked read-only.** The inputs
  had a `CanvasText 20%` border that's invisible on the dark panel + a `Canvas`
  background identical to the panel, so the greyed placeholder read as a *fixed
  value you can't change*. A novice's exact words: "since there isn't a box
  around it … it looks like that is fixed and something you can't change."
  Fixed by bumping the border to `CanvasText 38%`, adding a 7% inset fill, and a
  blue focus ring (`.ip-field input.ip-input` in BuildCanvas.svelte). Same class
  is used by the subnet-zone CIDR and BDT-peer inputs, so they all benefit.
  *Lesson for the broader UI: audit every input for a visible affordance on the
  dark theme — this pattern likely repeats elsewhere.*

- **G9 (P1) — ✅ ADDED LIVE — no validity feedback on addressing.** James:
  "we need a red error if we have too many or not enough digits for addressing,
  green box when it looks correct." The device IP/Mask/GW fields had *no*
  feedback at all (only the zone/router CIDR fields turned red, never green).
  Added live red/green-as-you-type: empty stays neutral (no premature nag),
  green when the value parses, red when it doesn't — with a teaching tooltip on
  the red state ("four parts, each 0–255"). Mask additionally requires a
  *contiguous* mask (255.255.0.255 → red). Extended green to the zone-CIDR and
  router-interface fields too. Verified: `10.0.1` → red, `10.0.1.10.5` → red,
  `10.0.1.300` → red, `10.0.1.10` → green. *Helpers ipAddrState/maskState/
  gwState in BuildCanvas.svelte; CSS on input.ip-input.valid.*

## Step 3 — Starting the field bus + the Network tab

- **Field bus IS discoverable (positive).** The `WIRES` selector (Auto /
  BACnet/IP / MS/TP / N2 / LON / Hardwired) is front-and-center in the dock; the
  novice found it unprompted as the way to start a field bus.
- **G10 (P1) — Real-world network models give no decision basis.** James:
  "asides from manufacturer what differentiates the real world modules? the
  benefits and differences are not clear to me, I wouldn't know where to start
  as a newbie (and maybe even a bit as an amateur tech)." The catalog tiles show
  vendor / model / family / protocols / price band, but the actual
  differentiators — hardware-vs-software, IP-only vs IP+MS/TP routing,
  translation-gateway vs pure router, dedicated-box vs role-on-existing-gear —
  live ONLY in the hover tooltip (`title={gear.notes}`). The decision info
  exists; it's just hidden. **Recommendation:** surface a one-line "use when…"
  role string inline on each tile (split it out of the `networkGear.ts` notes),
  group the catalog by *function* (IP↔MS/TP router+BBMD · software BBMD ·
  multi-protocol gateway) rather than by vendor, and add a "do I even need this?
  (only with 2+ subnets)" hint at the top. Deferred (not blocking; our flat site
  needs none of it).
- **G11 (P3) — Separator lines aren't uniform.** Divider lines between
  dock/panel sections vary in weight/length. Cosmetic; fold into a styling pass.

### THEME EMERGING — "decision guidance" is the #1 recurring gap
G1 (supervisor picker), G3 (protocols), and G10 (network models) are the same
problem: the tool lists specs beautifully but never tells a beginner *how to
choose* or *whether they even need to*. A single cross-cutting fix —
"recommended default + one-line when-to-use + hide/defer choices you don't need
yet" — would address all three. Strong candidate for a dedicated slice
("beginner decision affordances") after the L2 track.

## Step 4 — First controller on the MS/TP field bus

### Positives (things that worked + taught correctly)
- **MS/TP wiring + addressing works and is visible.** Wiring JACE→VAV-1 on MS/TP
  auto-assigned + displayed `MAC 0 · DI 1000` (JACE) and `MAC 1 · DI 1001`
  (VAV-1). The MAC badge on the card is exactly the "what address is this?"
  feedback we wanted; the inspector `MAC` field (default "auto") lets you
  override to mirror a real dip-switch setting.

### Findings
- **G12 (P1, BIG — product-thesis) — incompatible wiring is hard-BLOCKED, not
  allowed-and-flagged.** Setting WIRES→BACnet/IP and wiring JACE→Distech ECY-VAV
  (MS/TP-only) was refused outright by `validateWireCompat`. James: "we may want
  to still be able to wire it like that so the user can create a mistake and dig
  into what they did wrong." This is the core teaching premise — a sim that
  prevents mistakes can't teach you to diagnose them. **Recommendation:** split
  refusals into two classes. *Topology-impossible* (terminal already wired;
  controller getting a 2nd supervisor) stays a hard block. *Misconfiguration*
  (protocol mismatch; wrong wire-kind to a device) becomes **allow-but-faulted**:
  create the edge, style it red/dashed, tag `edge.data.fault`, log a runtime-log
  entry + surface a finding ("VAV-1 is MS/TP-only — it has no Ethernet port, so
  it can't communicate on a BACnet/IP trunk"). Mechanism: change
  `validateWireCompat` to return `{severity:'block'|'fault', reason}`; in
  `onConnect`, 'fault' creates the edge instead of returning. Touches
  `withStyle` (fault edge style) + the findings/runtime-log path. Scoped, ~1
  focused slice. **Highest-value find of the session — it IS the product.**

  **✅ BUILT (James's refined spec).** Implemented as a two-mode system + an
  on-demand reveal:
  - **Easy mode** (default): incompatible wire blocked, can't continue — as
    before.
  - **Realistic mode**: the field — the bad wire is allowed through with *zero*
    automatic warning; the reason is stashed on `edge.data.miswire`.
  - *Topology-impossible* connections (terminal already wired, 2nd supervisor)
    stay hard-blocked in **both** modes — `validateWireCompat` now returns
    `{severity:'block'|'fault'}`; only `fault` is let through in realistic mode.
  - **Local AI** can catch it: the assistant's topology summary now tags miswired
    edges (`⚠ MISWIRE: …`) so "Diagnose" surfaces it when asked.
  - **"Check my work"** button (no-AI fallback): a modal aggregating miswired
    edges + the last IP/MS-TP validator findings. Works in both modes.
  - Persisted toggle (`bas-sandbox.guidance-mode`) in the top-left canvas
    toolbar. Verified: toggle switches + persists, modal opens with correct
    empty state, typecheck clean.
  - *Follow-ups noted:* (a) realistic mode should eventually also gate the
    always-on Conformance pill / network-health / runtime-log findings (true
    "no feedback"); (b) a miswired trunk should make the device actually fail to
    communicate in the sim (offline / no packets) so the symptom is real, not
    just a tagged edge. Both deferred — this slice nails the wire-time behavior +
    reveal.
  - **G14 — ✅ BUILT — "Auto" wire kind is Easy-mode only.** James: "make it so
    the auto wire only pops up in easy mode." Auto ("smart-pick") infers the
    protocol for you — a training wheel with no field equivalent. Now hidden from
    the WIRES palette in Realistic mode; switching to Realistic snaps any 'auto'
    selection to MS/TP so `onConnect` never silently auto-infers. Verified: Easy
    shows Auto + 5 kinds, Realistic shows 5 only.

## Step 5 — Wiring + programming the sensor

### Positives
- **Realistic mode correctly allows any wire kind on the sensor.** The
  allow-the-mistake behavior works as intended/desired (James confirmed: "we
  want to be able to use any wire to wire sensor up in realistic mode").

### Findings
- **G15 (P2) — ✅ FIXED — a device could be wired to itself.** The novice made a
  self-loop edge (sensor → same sensor). Now blocked in BOTH modes (topology-
  impossible, not a teachable field mistake) via a `source === target` guard in
  `onConnect`. The guardrail James asked for alongside "allow any wire."
- **G16 (P2) — ✅ FIXED — Assistant panel drag-header escaped above the top.**
  "the top of it keeps getting bumped out of the screen so i can[']t move it by
  dragging the top." The panel is bottom-anchored with the drag handle at its
  top; `max-height: 30rem` exceeded short viewports, so the excess pushed the
  header above the top edge where it couldn't be grabbed. Capped to
  `min(30rem, calc(100% - 4.5rem))` so it never outgrows the viewport. Verified
  at 1100×380: header stays on-screen and grabbable.
- **G17 (P1) — "Terminal" (CLI) vs "Terminals" (I/O config) — naming collision.**
  The controller exposes a `Terminal` button (an IOS-style command shell whose
  `program` command opens the Structured-Text editor for control LOGIC) AND a
  `Terminals` button (the visual panel where you set each input's TYPE — Pt1000,
  thermistor, etc.). The novice wanting to "program the input" opened the CLI,
  hit a `VAV-1>` prompt, and was stuck — reasonable, given the names differ by
  one letter and both sound like "where I configure the terminal." **Fix:**
  rename the CLI surface (e.g. "Console" / "CLI") and/or the I/O panel (e.g.
  "I/O" / "Points & Inputs"); add a one-line "what is this?" on the CLI.
- **G18 (P1, confirms the day-1 ask) — ✅ BUILT — no nickel RTD.** The sensor SIGNAL options
  are: Pt1000 RTD (platinum), 10kΩ Type II (thermistor), 0–10V, 4–20mA, Dry
  contact. There is **no nickel (Ni1000) option** anywhere. James's founding
  requirement — "I'd need to know if I need a platinum or nickel sensor, program
  it accordingly" — literally cannot be exercised: you can pick platinum but not
  nickel. (Also worth noting: the picked sensor BA/10K-3-W-BB is a *thermistor*,
  not an RTD at all — a teachable distinction the UI doesn't draw out.) **Fix:**
  add nickel RTD types (Ni1000 DIN/LandisGyr 1k@0°C, Ni1000 @70°F) to
  `SensorSignal` + the resistance curve in `signals.ts` + the controller
  `TerminalInputType`, so the platinum-vs-nickel commissioning choice (and the
  classic "controller set to Pt1000 but a nickel sensor is wired" mismatch
  fault) becomes a real lesson.

  **✅ BUILT.** Added `rtd-ni1000` end-to-end:
  - Core `SensorSignal` + `TerminalInputType` + the linear nickel curve in
    `signals.ts` (`NICKEL_ALPHA = 0.00618`, DIN 43760 — ~1.6× platinum's slope),
    plus encode/decode/open/short/over-under-range/peg coverage.
  - Two nickel sensor models in the catalog (JCI TE-6300 Ni1000 averaging probe,
    BAPI BA/N1K zone sensor).
  - UI: "Ni1000 RTD" signal chip on sensors (verified rendering) + "RTD · Ni1000
    (nickel)" in the controller terminal input-type dropdown; Pt labels now say
    "(platinum)" to draw the contrast.
  - Tests: nickel round-trip across range, steeper-than-platinum curve, and the
    headline **silent-reads-high** case — a Ni1000 sensor decoded by a
    Pt1000-set terminal reads ≈96 °F instead of 72 °F with NO mismatch flag
    (both are resistive, so the controller never notices). 351/351 core tests
    pass, UI typecheck clean.
  - *Note:* because nickel and platinum are both `resistance-ohms`, this miss is
    invisible to the kind-mismatch detector by design — exactly the silent
    field failure. A future "curve sanity" check could flag an implausible
    reading, but the silent version is the authentic lesson.
- **G13 (P2) — controller catalog: hard to find the VAV-sized box.** The novice
  picked Distech ECY-VAV (`unitary`) as "closest to right" because "everything
  else seemed like overkill for a VAV." Correct pick, but: (a) the
  `field`/`plant`/`unitary` application tags are never explained (a beginner
  doesn't know `unitary` = VAV/single-zone), and (b) `unitary` has only one
  option while `field`/`plant` dominate, so the catalog skews large. **Fix:**
  explain the application tags (tooltip/legend), add a couple more unitary/VAV
  controllers, and let the picker filter by application ("I'm doing a VAV box").
  Same decision-guidance theme as G1/G3/G10.

## Step 6 — Terminals panel, connectors, naming

- **G17 follow-through — ✅ FIXED — renamed the CLI "Terminal" → "Programming."**
  James: "rename the coding terminal to just programming." The `>_ Terminal`
  button (IOS-style ST console) is now `>_ Programming`, and the CLI panel header
  reads "— programming." Removes the one-letter collision with the "Terminals"
  I/O panel.
- **G19 (P2) — Terminals panel reads empty until the sim runs.** The novice wired
  a sensor correctly but the panel said "No wired sensors detected," because
  `buildRows()` reads `controllerBridge.terminalSignalsByCtrl`, only written
  inside the sim loop (`runBridgePass`). So you can't see the wired terminal — or
  set its input type — until you hit ▶ Run, which is backwards (you'd want to
  program the curve before running). **Interim fix:** rewrote the empty-state to
  say it's a live view, "hit ▶ Run," and what a still-missing terminal means.
  **Recommended build:** populate the panel statically from edges + terminal
  config when stopped (hoist/parameterize `runBridgePass` with nominal inputs).
- **G20 (P2) — ✅ FIXED (tooltips) — connectors didn't say in vs out.** James:
  "for the bottom and top connectors, we should probably specify that they are
  inputs or outputs… kind of a guessing game." Added hover tooltips: top
  `net-in` = "Network IN (top)…", bottom `net-out` = "Network OUT (bottom)…"
  (verified they forward to the DOM). Controller per-terminal handles already
  color-code UI/AI/BI (left, inputs) vs outputs (right). *Could later add a tiny
  in/out arrow so it reads without hovering.*

## Step 7 — Untangle sensor setup (DESIGN LOCKED, build in progress)

James pushed back: clicking the sensor shows "platinum selected," while the
terminal is "programmed nickel" — two type-pickers with overlapping vocab and no
visible relationship. The tangle, precisely:
1. The sensor's "SIGNAL" reads like a free setting, when a real sensor's element
   is **fixed by the device you installed** (a BAPI BA/1K *is* platinum).
2. That row mixes resistive **elements** (Pt1000/Ni1000/10kΩ) with **transmitter
   outputs** (0–10V/4–20mA) with **binary** (dry contact) — different physics as
   flat peers.
3. Sensor element and terminal "configured as" are never shown together, so you
   can't see they disagree.

### Decisions (James)
- **D1 — Sensor element is FIXED by the physical device.** Read-only once chosen
  (set by the catalog model; pick-once for a generic sensor). The only thing you
  *program* is the controller terminal. Mismatch ⇔ terminal type ≠ installed
  sensor element.
- **D2 — Mismatch visibility is mode-gated, and grounded in what's physically
  knowable.** Key insight from James: *a real controller can't know what element
  is wired to it* — it just reads ohms and applies its configured curve. So the
  "installed vs programmed" view is **sandbox omniscience**, shown only as a
  training aid:
  - **Easy:** Terminals panel shows `Installed: Pt1000 · Programmed as: Ni1000`
    side-by-side + a mismatch flag.
  - **Realistic:** NO installed/mismatch hint — only the raw Ω + scaled reading
    the controller actually has. The wrong number is the only tell. (Don't even
    show "installed," because the controller wouldn't know it.)
- **G19 (pre-run populate) — confirmed wanted.** The Terminals panel must show
  wired terminals + let you set the curve BEFORE ▶ Run, not only while running.

### Build slices
- **S1 — ✅ BUILT — Sensor element fixed by the device + grouped for generic.**
  Catalog sensors show a read-only "Installed element: <type> · 🔒 fixed by
  <model>" (verified: TE-6300 → "Ni1000 RTD (nickel)"). Generic sensors get a
  grouped picker (Temperature element / Transmitter output / Binary) instead of
  the flat mixed row. So the sensor stops looking like an editable setting — it's
  the device — and what you *program* is the terminal.
- **S2 — ✅ BUILT — Terminals "truth table" + pre-run population.** Verified:
  - **Easy mode:** columns `Terminal · Installed · Programmed as · Raw · Scaled ·
    Status`. Program UI-1 as Ni1000 while a Pt1000 is installed → Installed cell
    flags red + Status = **MISMATCH** (sandbox omniscience).
  - **Realistic mode:** the Installed column disappears and the same wiring shows
    Status = **OK** — controller-reality only, because a real controller can't
    know what element is wired. The wrong reading is the only tell.
  - **Pre-run (G19 ✅):** the panel now populates with `running:false` — a static
    bridge pass (`runStaticBridgePass`, gated to stopped, wrapped in `untrack`)
    rebuilds snapshots from the wiring at a nominal operating point, so you set
    the curve BEFORE Run. Snapshot now carries `installedSignal` (sandbox truth).
  - Guidance mode moved to a shared `guidanceStore.svelte.ts` so the panel reads
    it; mismatch = `defaultInputTypeFor(installed) !== programmed type`.
  - Caught + fixed a Svelte `state_unsafe_mutation` loop (effect writing the
    shared bridge state) via `untrack`.
- Polish riding along: **G21 ✅** delete-button overflow fixed (inspector header
  now `flex-wrap`s + Delete pushed to the end so it can't clip). **G22 ✅** the
  unclear inspector-button emojis (📝/🔌/📐/▦) dropped — buttons are now plain
  text (Programming keeps `>_` as a console cue).

## Step 8 — Actuators / the output side (UNDER-BUILT — needs a parity pass)

James wired an actuator and found it's the half of I/O that never got the sensor
treatment. The sim engine HAS the actuator model/signal/fail-safe/dynamics logic
(actuators.ts + the controller→actuator pass in BuildCanvas); the **authoring UI
is missing**. This is essentially "do for actuators what Step 7 did for sensors."

- **G20 (REOPENED, P1) — in/out connectors still not visible.** Tooltips were a
  half-measure; James: "still don't see where my input and outputs are on the
  boxes, still has not been fixed." Needs an ALWAYS-VISIBLE cue (in/out glyph,
  arrow, or label), not hover-only. Bundle into the node-handle pass.
- **G23 (P1) — actuators have NO inspector.** Every other node kind gets an
  inspector panel (rename, config, Delete). Actuators get nothing — so you can't
  delete one from a panel (keyboard Delete/Backspace still works) and there's
  nowhere to configure it. Build an actuator inspector.
- **G24 (P1) — actuator drop doesn't prompt a model + no config.** 'actuator'
  isn't in `needsPick`, so a dock drop is a generic actuator with no signal, no
  fail-safe, no control type. James: "doesn't make me choose a control signal,
  fail safe, proportional/incremental — pretty sparse." Need: model picker (or
  inspector picker) for signal (2–10 V / 0–10 V / 4–20 mA / floating-3-point),
  fail-safe (spring-return open/closed), and modulating-vs-floating.
- **G25 (P1) — controller→actuator AO/BO mismatch not caught.** James assigned a
  (modulating) actuator to a BINARY output and Check-my-work (Easy) flagged
  nothing. Root cause: a generic actuator has no signal, so the onConnect
  signal-match validation (wantsAnalog/wantsBinary, which DOES exist for
  model-backed actuators) has nothing to check. Once G24 gives actuators a
  signal, wire the same Easy/Realistic mismatch treatment we built for sensor
  terminals (S2) onto the output side: AO-vs-BO and analog-vs-binary mismatch.
- **G26 (P2) — no actuator position feedback.** James: wiring an actuator → a
  controller INPUT is actually correct for position feedback (a 2–10 V feedback
  line from an actuator with built-in feedback back to a UI/AI). Today that's
  allowed but unmodeled. Add feedback as a first-class option (actuator emits a
  feedback signal; controller reads it on an AI).

**Recommended:** a dedicated "actuator parity" build (Step 8 build) mirroring
Step 7 — inspector + model/signal/fail-safe picker + AO/BO mismatch (mode-gated)
+ feedback + Delete. Deferred per James ("saving for later"); tracked here.

### ✅ BUILT (actuator parity, this session)
- **G23 — ✅ actuator inspector + Delete.** Actuators now get a full inspector
  panel (rename, Delete button, device + specs) like every other node. Verified:
  Delete removes the actuator.
- **G24 — ✅ model picker + config.** Dropping an actuator now prompts the model
  picker (ACTUATOR_CATALOG: Belimo/Honeywell/ABB/Danfoss/Square-D…); the inspector
  shows the device's **signal · fail-safe · stroke · feedback**, fixed by the
  model (mirrors the sensor "fixed by device" decision D1). Verified: picker
  shows "Pick an actuator" with real rows; inspector shows `Belimo AF24-MFT ·
  2–10 V · fail-closed · 95s stroke · position feedback`.
- **G25 — ✅ root cause fixed.** The "assigned to a binary output, nothing
  caught it" symptom was because a *generic* actuator had no signal to validate.
  Now that actuators are model-backed, `onConnect` auto-routes an analog actuator
  to an AO terminal (and a binary one to a BO).
- **G25-full — ✅ BUILT (2026-06-09 session 2).** Realistic mode now lets a
  deliberate aim at a FREE wrong-kind output terminal through (analog actuator →
  BO, binary → AO) with zero warning, tagged on `edge.data.miswire` — same
  reveal path as the protocol miswires (Check-my-work + AI summary). Easy mode
  keeps the helpful auto-shift. Auto-shift still resolves taken terminals and
  non-terminal drops in both modes. *Verified via code path + the shared
  miswire display (Check-my-work render confirmed live); the wire-drag gesture
  itself needs one manual confirmation in the browser.*
- **G26 — ✅ BUILT (2026-06-09 session 2), verified end-to-end live.**
  - **Feedback path:** an actuator wired INTO a controller input (actuator →
    AI/UI) now emits its position as a 2–10 V signal when the model has
    `hasPositionFeedback` — shows as a real row in the Terminals truth table
    (verified: Belimo AF24-MFT at 100% → `AI-1 · 10.000 V · 100.00 [0–100] ·
    OK`) and feeds the program env as `fb_<actuator-label>`. Pre-run static
    pass shows the row too (G19 parity).
  - **Stuck fault:** actuator inspector gained a Fault row (normal / stuck).
    Stuck freezes `actual` while commands keep coming; the node card shows
    "⚠ stuck at 100% (cmd 20%)" in Easy (in Realistic just the never-closing
    "(cmd …% ↑)" — the authentic symptom).
  - **Check-my-work** reports "commanded but didn't move" with the
    feedback-vs-no-feedback teaching note (verified live).

## Step 9 — AHU (G36) + driving conditions

- **G27 — ✅ BUILT (2026-06-09 session 2).** "🌤 Conditions" button on the run
  toolbar opens the one box for "what's the world doing": OAT row (From weather
  ↔ Manual slider −20–110 °F; manual persists to localStorage and overrides the
  weather sample for EVERY consumer — physics-wired targets AND standalone
  AHU/zone nodes) + Time/occupancy row (live sim clock, occupied % pill, the
  actual 06:00–19:00 office schedule, pointer to the start-hour control).
  Verified live: manual 95 °F flipped the G36 cold-start demo from
  heating-premise to Cooling with econ correctly locked out (OA damper pinned
  at 20% min). Original gap text follows for history.
- **G27 (P1, original) — no unified "conditions" control; OAT + occupancy are scattered.**
  James (running the AHU): "not sure where to change occupancy and OAT settings —
  intuitively I should have a box with environmental settings somewhere, which I
  thought we had." Reality: **OAT** is driven by the WEATHER sidebar tab
  (weatherStore; default ~60°F with no city), **occupancy** is derived from the
  sim clock (`simStartHour` in the run toolbar) + a hardcoded
  `defaultOccupancySchedule` (6am–10pm) — there's no user-facing occupancy/time
  box and no single place for "the conditions I'm simulating." **Recommendation:**
  one discoverable **Conditions** panel near the canvas: OAT (manual slider +
  "from weather" toggle), occupancy/time-of-day, maybe internal-load — the
  things you turn to make the building *do* something. Today a newbie can't find
  how to make the AHU leave Unoccupied.
- **G28 — ✅ BUILT (2026-06-09 session 2).** The AHU now gets a full inspector:
  rename + Delete, a self-description (what it reads, where OAT/occupancy/zone
  temp come from, what it exposes), LIVE sequence state while running (mode ·
  SAT sp · OA damper · heat/cool valves · fan; OAT/RAT/MAT/DAT + occupied
  pill), and the G36 config chips (zone sp / SAT cool / SAT heat / econ limit /
  min OA). Pre-run it shows a "Press ▶ Run" hint. Verified live in both the
  cold-start and economizer demos. *Config EDITING still deferred — chips are
  read-only.* Original gap text follows.
- **G28 (P2, original) — AHU drops as an opaque box.** James: "just drops in as a box,
  nothing special." The G36 §5.18 AHU runs a real sequence + synthesizes 15
  BACnet objects, but the node doesn't explain what it controls, its I/O, or how
  it relates to the VAVs/zone. Needs an inspector / self-description like the
  other nodes (and a way to see its mode/SAT-setpoint/damper/valve live).
## Step 10 — found during the 2026-06-09 session-2 testing pass

- **G30 (P1) — ✅ FIXED — `T_zone_init` was set by demos but consumed nowhere.**
  Both G36 demos pin a zone start temp (`T_zone_init: 62` cold-start /
  `76` economizer), but the zone init path ignored it — zones always
  initialized at ambient/OAT. The economizer demo's premise silently never
  happened (zone started at OAT 58 °F instead of 76 °F, so it never called for
  cooling). Fixed: the zone step now reads `zoneConfig.T_zone_init` ahead of
  the OAT fallback. Verified: economizer demo now starts warm → Economizer
  mode, OA damper 100%.
- **G31 (P3) — occupancy schedule documentation drift.** The gap log + UI copy
  said "6am–10pm" but `defaultOccupancySchedule` is actually 06:00–19:00
  (ramp-down 17:00–19:00). Conditions-panel copy now states 06:00–19:00.
  *Open question for James: should the schedule itself extend to 22:00?*
- **G32 (P2) — generic controllers render no terminal handles, so auto-shifted
  edges are invisible.** `onConnect` auto-routes a controller→actuator wire to
  `AO-1`, but a generic (no-model) controller node only renders `net-in`/
  `net-out` handles — xyflow can't anchor the edge, so the wire exists in the
  sim but draws nothing on canvas. Confirmed live (demo controller + dropped
  actuator). Candidate fix: render terminal handles on generic controllers
  (16-channel default), or fall back to net-out for the visual.

- **G33 — ✅ FIXED + VERIFIED (2026-06-09 session 2).** `.wire-panel` was a
  single non-wrapping flex row that grew without bound and slid its right edge
  (the Delete button) under the top-right sim panel. Now `flex-wrap: wrap` +
  `max-width: min(42rem, calc(100% - 24rem))` + centered, so it stays compact
  and wraps instead of overflowing. Verified at 1920px: trunk panel right edge
  1044, Delete button right edge 1010, sim panel left edge 1222 — fully clear.
- **G33 (P3, UI, original) — trunk-inspector "✕ Delete" button hidden behind the Run
  button.** When you select an MS/TP wire, the trunk inspector toolbar
  (`TRUNK · BACnet/IP · MS/TP · … · baud · ✂ Break trunk · ✕ Delete`) renders
  across the top of the canvas and runs UNDER the top-right sim panel
  (▶ Run / Reset sim / clock). The Delete button is the last item, so it's the
  one that gets clipped — you can't reliably hit it. James caught it live.
  **Fix:** the trunk-inspector panel and the sim panel both live at the top of
  the canvas and collide on narrower viewports; give the trunk inspector its
  own row / wrap, or right-pad it clear of the sim panel. (Same family as the
  G21 inspector-Delete clipping fix — Delete buttons keep landing under other
  chrome.)

- **G34 — ✅ FIXED (2026-06-09 session 2); part (a) verified live, part (b)
  needs one manual wire-gesture confirmation.** Two-part fix per the
  allow-and-flag thesis:
  - **(a) No fake MAC** — `assignMstpAddressing` ([mstp.ts:239](packages/core/src/bacnet/mstp.ts))
    now filters `sensor`/`safety`/`actuator` out of trunk MAC assignment (they
    stay in the connectivity graph so the trunk still forms between real
    devices, but never get a MAC/DI). **Verified live:** injected a
    controller→actuator MS/TP edge → actuator `DMP-1` shows *no MAC* while the
    real controllers keep theirs (master MAC 0, child MAC 1).
  - **(b) Flagged miswire** — `validateWireCompat` now treats the field-device
    rule as `{sensor, safety, actuator}` (was sensor/safety only): a network
    wire (mstp/bacnet-ip/n2/lon) to any of them returns `severity:'fault'` with
    a "no network port — use Hardwired" reason. Easy blocks it; Realistic tags
    `edge.data.miswire` → Check-my-work + the AI surface it. Logic is identical
    to the proven sensor/safety path; the live wire-drag gesture can't be
    synthesized in the preview harness, so James should confirm with one manual
    wire (Realistic: MS/TP controller→actuator → "Check my work" lists it;
    Easy: the wire is now refused with the Hardwired hint).
  - 351/351 core tests pass, UI typecheck 0 errors.
- **G34 (P1, product-thesis, original) — an actuator can be wired onto an MS/TP trunk
  and silently becomes a fake BACnet device; the helper doesn't catch it.**
  In Realistic mode, with MS/TP as the selected wire kind, James wired
  VAV-1 → LR24-3 (a Belimo valve actuator). The actuator got pulled onto the
  MS/TP trunk and **assigned `MAC 2 · DI 1002`**, bumping VAV-1 to `MAC 3`.
  But a damper/valve actuator is a *dumb hardwired field device* — no RS-485
  port, no MAC, no Device Instance. It's driven by the controller's **AO over
  a hardwired signal wire**. Root cause: `assignMstpAddressing`
  ([mstp.ts:194](packages/core/src/bacnet/mstp.ts)) filters edges by
  `wireKind === 'mstp'` and assigns a MAC to *every* node on the resulting
  trunk, with no kind exclusion — so an actuator (or sensor / safety) wired
  with MS/TP joins the trunk as a peer. Worse, neither the Realistic miswire
  tag nor **Check-my-work** flags it ("its back on the helper isnt catching
  the issue") — so the impossible wiring masquerades as a valid networked
  device. **Fix (allow-and-flag, per the thesis):** (a) exclude field-device
  kinds (`actuator`/`sensor`/`safety`) from MS/TP MAC assignment — they never
  get a MAC; (b) in `validateWireCompat`, treat a network wire kind
  (mstp / bacnet-ip / n2 / lon) to an actuator/sensor/safety as a `fault`
  ("a damper/valve actuator has no network port — wire it Hardwired to a
  controller AO"), so Easy blocks it and Realistic tags `edge.data.miswire`
  → Check-my-work + the AI surface it; (c) optionally auto-pick Hardwired for
  controller→actuator drops the way Auto does. Highest-value find of this pass
  — it's the same "sim must let you make the mistake AND be able to reveal it"
  premise as G12.

- **G35 (P2, decision-guidance) — ✅ FIXED + VERIFIED — actuator picker was a
  flat 14-item scroll.** James (real tech) grabbed a `valve-modulating` from
  habit when reaching for "the VAV actuator," because nothing distinguished a
  damper from a reheat valve: "I think we would need a way to separate dampers,
  actuators, etc." Same decision-guidance theme as G1/G3/G10/G13. **Fixed:** the
  `ModelPickerModal` now groups actuators by family with section headers —
  **Dampers** ("Throttle airflow — a VAV box's primary output. Start here.") ·
  **Valves** · **VFDs** · **Relays & starters** — in that order, with a one-line
  blurb per family. Search still filters across families and hides empty groups.
  Verified live: all four headers render in order, dampers lead, "vfd" search
  collapses to just the VFDs group. *Still open: a "for a VAV box, start with a
  damper" nudge is in the Dampers blurb but not at the dock-drop moment; the
  same grouping treatment should extend to the sensor/safety pickers.*

## Step 11 — solo "demo premise audit" (2026-06-10, Claude-driven sweep)

Method: load every bundled demo, run it, and verify the sim actually does what
the demo's description promises — plus fault injections and Check-my-work
sweeps. Found two P1 state bugs, one validator false-positive, one design
incoherence. All four fixed/addressed same-session; 351/351 tests, typecheck
clean, build clean after.

- **G36 (P2, design) — TWO independent occupancy schedules can contradict each
  other on screen.** The "Occupancy schedule" demo runs its controller on a
  per-target `config.schedule` (06:00–22:00, occ 72 / unocc 78 — thermal.ts
  `effectiveSetpoint`), while zones / vAHUs / the Conditions panel read the
  global `defaultOccupancySchedule` (06:00–19:00, zone.ts). At sim-20:00 the
  demo VAV holds the occupied setpoint while the Conditions panel says
  "unoccupied." **Visibility fix shipped:** the Conditions panel now labels the
  global row "zones / AHUs" and lists every wired target with its OWN enabled
  schedule (window + occupied/setback + active SP), so the two sources are
  side-by-side instead of silently contradicting. **Open design call for
  James:** unify on one schedule source (Conditions panel as master? per-zone
  schedules?) — relates to the G27 panel and the G31 19:00-vs-22:00 question.
- **G37 (P1) — ✅ FIXED — demo/scenario loads leaked protocol state across
  topologies; one leak also silently suppressed Who-Is.** `applyScenario()`
  cleared the packet capture but not `covSubscriptions`, `mstpTrunkStates`,
  poll schedules, retry state, the runtime log, or `simStartHour`. Demos reuse
  generic node/edge ids, so consequences observed live: (a) **ghost packets** —
  demo 0's "VAV-SF" kept emitting ConfirmedCOVNotifications inside demo 1's
  capture (stale subscription with cached label passed the liveness check);
  (b) **Who-Is/I-Am never fired** on the quick-start demo — the stale
  `mstpTrunkStates` made the new trunk look already-discovered, so the whole
  discovery bootstrap was skipped (the conformance checker correctly flagged
  it, contradicting the demo's own description); (c) demo-4 gateway errors
  lingered in the runtime log under the healthy BBMD demo; (d) a start hour
  set for one demo leaked into the next. Fixed: applyScenario resets all of
  it. Verified live: 0 ghosts, full Who-Is → I-Am → SubscribeCOV dance,
  clean log, start hour 0.
- **G38 (P2) — ✅ FIXED — validator called Annex-J foreign-device registration
  an ERROR.** The BBMD demo ("laptop registers as a foreign device with
  NAE-A") tripped `Cross-subnet BACnet/IP needs BBMDs on BOTH ends` — but a
  non-BBMD cross-subnet device registering with a BBMD is exactly the
  legitimate Annex-J FD pattern (it's how every commissioning laptop joins a
  site), and the sim itself emits Register-Foreign-Device for that topology.
  The validator contradicted the sim. Now `ipv4.cross-subnet-foreign-device`,
  info-level, with the TTL/re-registration field caveat. Test updated to
  assert the new semantics.
- **G39 (P1) — ✅ FIXED — ALL BACnet/IP COV notifications were dead; the "COV
  firehose" demo streamed zero.** The per-tick subscription cleanup built its
  liveness index from MS/TP trunk members only, so every `ip-edge:`/`ip-host:`
  subscription was deleted one tick after creation — SubscribeCOV went out,
  ACK came back, then the supervisor forgot. Verified before: 4.5 sim-hours,
  64 polls, 8 subscribes, **0 notifications**. After: IP subs live as long as
  their child node exists → **17 ConfirmedCOVNotifications** streaming in the
  same window. The flagship watch-the-bus demo works again.
- **P3 notes from the sweep:** demo-0's description quotes example values
  ("~11.2 mA at 900 ppm", "~6 V at 50%") that assume occupied hours / mid-stroke
  state — at the default 00:00 start a learner sees 7.6 mA / 450 ppm and may
  think it's broken. And the permanent "I-Am replies missing required fields"
  conformance warning (a documented sandbox limitation) reads like the
  LEARNER's mistake — consider a distinct "sandbox limitation" severity so it
  doesn't look like their topology is wrong.
- **Audit scorecard:** demos 0–12 all premise-checked. PASS: signal fidelity,
  quick-start (after G37), trunk break (break/restore + retry→comm-lost),
  occupancy (after G36 visibility), subnet mismatch, duplicate MAC, BBMD+FD
  (after G37/G38), JACE 5 vVAVs power-off, winter heating, COV firehose
  (after G39), mid-rise 12 vVAVs, G36 cold-start + economizer (fixed
  yesterday, G30).

- **G40 (P2, physics) — the AHU's supply air barely conditions its wired
  zone.** Found during slice-4 verification: AHU in Economizer, OAD 100%,
  DAT 60 °F — and the wired zone still climbed 80→123 °F from its internal
  loads (the same slow climb is visible in the G36 demos: economizer demo
  zone went 76→79.6 °F *up*). The vahu→zone edge feeds the AHU its zone
  TEMP, but the supply-air heat removal back INTO the zone is weak/absent —
  the zone's only strong physics are envelope + internal loads. Fix belongs
  in the slice-5 air-side pass (fan CFM × ΔT(DAT, zone) as coil heat on the
  zone, like equipment coils already do).

- **G41 (P1) — ✅ MITIGATED — the ⚡ physics-target binding is an invisible
  prerequisite; everything LOOKS alive while the BACnet layer reads 0.**
  James wired a Pt1000 + damper actuator to an FEC2611, ran the sim, and
  watched ReadProperty-ACKs return `AI:1 = 0` with zero COVs — while node
  cards showed lively "Out %" values. Root cause: without the physics-target
  binding there's no thermal sim behind the controller, so `defaultAiSeed`
  has no sample and AI:1 synthesizes to 0 forever (verified: the SAME rig
  WITH the binding publishes the live zone temp, 72.0, on every ACK).
  **Mitigation shipped:** Run-start now emits a warning naming each
  sensor-wired-but-unbound controller and the exact fix (verified live).
  **Deeper fix to consider:** auto-bind on sensor wire in Easy mode, or fold
  the binding into wiring itself — the "physics target" concept is sandbox
  plumbing a real tech has no mental model for.
- **G42 (P3) — packet summaries could carry point NAMES, not just object
  ids.** James: differentiating "dampers modulating" from "temps changing"
  in the capture. Real wires carry `analog-input,1`, not names — but the
  sandbox knows them (BacnetObject.name: 'Zone Temp', 'OAD-POS'…). Append
  the name to ReadProperty/COV summaries (e.g. `AI:1 'Zone Temp' = 72.0`)
  — supervisor-style resolved display, flagged as sandbox nicety.

## Step 12 — first REAL capture (lab1, 2026-06-10): services the sandbox doesn't model

From `wireshark/lab1-first-contact.pcapng` (YABE ↔ bacserv 1.4.1 on James's
LAN) — each of these is on a real wire and absent from the sim:

- **G43 — ReadPropertyMultiple.** YABE's very first read is an RPM, not RP.
  Real supervisors batch-read; the sandbox only ever emits single
  ReadProperty. (Also the I-Am fix data is in this capture: Max APDU 1476,
  Segmentation, Vendor ID, NPDU DNET-65535 global broadcast — feeds the
  standing conformance ⚠ / structured-PDU migration.)
- **G44 — unsubscribed COV broadcasts.** bacserv emitted an
  `unconfirmedCOVNotification` for AV:1 with NO SubscribeCOV anywhere — the
  spec's subscription-less broadcast COV. The sandbox models only
  confirmed, subscription-based COV.
- **G45 — timeSynchronization / utcTimeSynchronization.** Real devices and
  supervisors sync clocks on the wire; unmodeled (and a fun teaching hook —
  schedules drift when timeSync is missing).
- **G46 — who-Has / i-Have.** Object-level discovery ("who has AI:1?") —
  unmodeled; pairs naturally with the Site Director's point search.
- (Open observation: bacserv's I-Am arrives ×2 ~150 µs apart per trigger —
  multi-send or capture artifact; resolve on a wired-Ethernet capture.)

From `wireshark/lab3-cov-lifecycle.pcapng` (the COV-lifecycle ground truth):

- **G47 — ✅ FIXED (2026-06-11) — no initial notification on subscribe.**
  Real devices notify the current value immediately on every (re)subscribe
  (observed ~12/12 times, 0.2–7 s later). The sandbox seeded
  `lastReportedValue` silently. Now every (re)subscribe schedules an
  initial ConfirmedCOVNotification 0.2–7 s out (deterministic hash jitter),
  tagged "initial notification (subscribe/renewal)" in the log. Verified
  live in the COV firehose demo. Implementation note: a pending initial
  must SURVIVE renewal re-arms — at high sim speeds a renewal lands every
  tick and naively rescheduling starved the initial forever.
- **G48 — ✅ MODELED (2026-06-11) — subscription lifetime/renewal not
  modeled.** Subscriptions are now 120 s leases (`COV_LIFETIME_DEFAULT_S`,
  carried in the SubscribeCOV wire bytes); the supervisor renews at exactly
  lifetime/2 — the SubscribeCOV+ACK heartbeat shows in the packet log
  tagged "· renewal", and the inspector decodes a Lifetime row. TTL-expiry
  ground truth came from lab7c (device silent at lease+115.3 s of 120):
  modeled as the "TTL ghost" — delete/lose the subscriber and the device
  keeps notifying until the lease lapses, then stops with a runtime-log
  warning ("no error on the wire; stale values just sit"). Verified live:
  deleted JACE-MAIN mid-run, all four VAV leases expired with the note.
  Lease math is pure + tested in `@bas/core` (`bacnet/cov.ts`, 9 tests).
- **G49 (flavor) — ✅ MODELED (2026-06-11) — COV detection is scan-based
  against last-NOTIFIED.** bacserv evaluates Δ vs the last value it
  notified, on a 0.2–7 s scan — rapid intermediate writes vanish without
  ever hitting the wire. The sandbox now gates each subscription's delta
  check on a per-subscription `nextScanAtSimSec` with deterministic 0.2–7 s
  jitter (same band as bacserv) — notifications lag changes and
  intermediate writes vanish, matching the capture.
- **G50 (lesson candidate) — duplicate subscriptions multiply traffic.**
  Real devices keep one subscription per (subscriber, process-id) — three
  stray YABE rows produced 3 notifications per change. The sandbox dedupes
  by object key, hiding a real failure mode worth teaching.
- bacserv **boot dance** (lab2): `who-Is <own instance range>` BEFORE i-Am —
  a device checking for instance collision at startup. Candidate sim
  behavior + duplicate-DI lesson tie-in.
- **G51 (lesson-grade, from lab5) — BACnet stacks silently fall back to
  EPHEMERAL UDP ports when 47808 is taken — and keep working.** Observed
  live: YABE↔RoomSim ran a full subscribe/notify conversation on
  61450↔63354. Consequences: port-filtered captures see nothing, Wireshark
  shows anonymous "UDP", port-based firewall rules don't match — a network
  that is provably alive while every standard diagnostic says silent. Cost
  us hours; would cost a real tech a truck day. Sandbox today hardcodes
  47808 everywhere. **Candidates:** model per-device UDP port (+ mismatch
  lesson: "devices on different ports can't hear each other's broadcasts");
  packet-log teaching note when traffic rides a non-standard port; ties to
  the fixed-instance/fixed-port commissioning discipline (G-roulette).
- **(observed, lab5) initial COV notification content differs BY STACK:**
  bacserv sends PV+status-flags; YABE's .NET stack sends the FULL object
  (name/units/reliability/…). The spec permits both — fixture for the
  structured-PDU work and a nice "vendors differ" teaching beat.

## Step 13 — mega-site stress build (2026-06-11): 47 nodes, 3 engines, 17 field MACs

James asked for a flurry — a stress-scale demo (`mega-site` in the demo
list) with three engines, two MS/TP trunks, a G36 AHU driving four
actuators, plant equipment, and eight wall-coupled zones. Built it, ran
it, and shook out four real findings in one session:

- **G52 — ✅ FIXED — thermal zones inherited NETWORK reachability.** The
  offline derivation radiates from supervisors over every edge, so a
  zone row coupled only by shared walls wore "⌀ OFFLINE · stale" badges.
  A room is a physical space, not a network device — zone kind is now
  excluded from offlineNodes (same reasoning that excluded zones from
  MAC assignment in slice 2).
- **G53 — ✅ FIXED — the hardwired-wire topology check predated the
  process chain.** It accepted only sensor/safety endpoints, so the mega
  site lit 14 false warnings on legitimate wiring (AHU→actuator,
  controller→equipment, equipment→zone, zone↔zone walls, actuator
  position feedback). Leaf set now includes actuator/equipment/zone/vahu.
- **G54 (P2, slice-5 physics pass) — unconditioned zones equilibrate WAY
  too hot: the model loses heat through ONE exterior wall only.** Mega
  site zones ran away past 240 °F (sealed-box equilibrium ≈ OAT+150 °F
  at default office loads). Root cause: no infiltration and no interior
  partition/ceiling/slab losses. **Infiltration SHIPPED** (0.35 ACH
  default, `infiltration_ach` config, 2 tests) — equilibrium now ~OAT+85
  at full loads, lawful but still high. The interior-conductance term
  belongs in the slice-5 air-side pass; tighten the zone test bound
  (currently <200 °F) when it lands.
- **G55 — zoneConfig silently ignores unknown keys.** Both shipped G36
  demos set `volume_ft3: 18000` but the config key is `volume_cu_ft` —
  their "18 000 ft³" zones ran at the 1 500 ft³ default since the day
  they shipped (fixed). A scenario-load warning for unrecognized
  zoneConfig keys would have caught it.
- (Confirmed in the wild: **G32** — a demo edge with `targetHandle:
  'UI-3'` onto a generic controller gets silently DROPPED by xyflow,
  with a per-render console warning. The mega site's VFD feedback wire
  now lands handle-less until G32 ships terminal handles.)
- (Validators earning their keep: the slice-2 EOL check caught the demo
  AUTHOR putting termination mid-chain on the plant trunk — first-draft
  mega site shipped FEC-BLR terminated in the middle. Exactly the
  mistake it exists to catch.)

- **G29 (P1) — ✅ FIXED — AHU/zones ignored the Weather drive's OAT.** James
  picked Atlanta (OAT 72°F) but the AHU stayed at 60°F. Root cause: the weather
  drive only wrote `sample.T_F` into *physics-wired targets'* config; the
  standalone AHU + zone nodes read `oatForZones`, which fell back to a hard-coded
  60°F when there were 0 physics targets — never consulting the weather store.
  Fixed: `oatForZones` now prefers the live weather OAT (`currentWeatherSample().T_F`)
  when the drive is active, then a physics target's OAT, then 60. Verified: NY
  68.2°F → AHU node reads OAT 68°F (was 60).
