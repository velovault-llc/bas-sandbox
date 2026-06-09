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
  to an AO terminal (and a binary one to a BO). *Still deferred:* the
  Realistic-mode "force the wrong output kind and flag it" treatment (mirroring
  the sensor terminal mismatch) — the auto-shift currently helpfully corrects
  rather than letting you make+see the mistake in Realistic.
- **G26 — still deferred.** Position-feedback is now *surfaced* in the inspector
  ("position feedback" chip), but the feedback signal path (actuator → AI, with a
  "commanded but didn't move" fault) isn't modeled yet.

## Step 9 — AHU (G36) + driving conditions

- **G27 (P1) — no unified "conditions" control; OAT + occupancy are scattered.**
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
- **G28 (P2) — AHU drops as an opaque box.** James: "just drops in as a box,
  nothing special." The G36 §5.18 AHU runs a real sequence + synthesizes 15
  BACnet objects, but the node doesn't explain what it controls, its I/O, or how
  it relates to the VAVs/zone. Needs an inspector / self-description like the
  other nodes (and a way to see its mode/SAT-setpoint/damper/valve live).
- **G29 (P1) — ✅ FIXED — AHU/zones ignored the Weather drive's OAT.** James
  picked Atlanta (OAT 72°F) but the AHU stayed at 60°F. Root cause: the weather
  drive only wrote `sample.T_F` into *physics-wired targets'* config; the
  standalone AHU + zone nodes read `oatForZones`, which fell back to a hard-coded
  60°F when there were 0 physics targets — never consulting the weather store.
  Fixed: `oatForZones` now prefers the live weather OAT (`currentWeatherSample().T_F`)
  when the drive is active, then a physics target's OAT, then 60. Verified: NY
  68.2°F → AHU node reads OAT 68°F (was 60).
