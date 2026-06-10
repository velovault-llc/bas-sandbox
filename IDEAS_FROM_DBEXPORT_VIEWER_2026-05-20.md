# Ideas for bas-sandbox from the dbexport-viewer session
# 2026-05-20

This is a notes file from a session spent extending dbexport-viewer (sprints v0.6.A through v0.7.E plus v0.8.F in flight) and digesting a parallel-tool project called **OCT** (`github.com/thecontrolscompany/oct`) maintained by **tcollins2** (Tim, `tim@ControlsCo.net`). Everything below is observation + suggested borrows, not implemented work. **Nothing here is committed code yet.**

Not committed by default — review, prune, or move into ROADMAP.md / ARCHITECTURE.md as it earns its keep. Safe to delete if it doesn't.

---

## TL;DR for bas-sandbox specifically

Five things became newly available upstream this session that map directly onto pending bas-sandbox phases:

1. **Property dictionary expanded 12×** (282 → 3,494 entries) via Apache-2.0 import from OCT's `shared/` directory. Currently only in dbexport-viewer; **should be mirrored into `@velovault/dbexport-parser` so bas-sandbox picks it up automatically**.
2. **Five new audit rules shipped** (self-refs, unreferenced objects, missing tags, placeholder names, I/O missing units) → directly fills Phase 1's pending rule list.
3. **OCT exists as a collaborator-grade parallel project**, openly tracks parity against dbexport-viewer in their `DBEXPORT_PARITY.md`. Their work answers several `bas-sandbox/ROADMAP.md` "open questions" — most importantly Open Q #2 (the ~30 unnamed CCT block IDs are now named).
4. **Class 844 vs class 717 graphics distinction** — Tim's `CONTINUITY.md` confirms class 717 = unrenderable Silverlight (dead legacy), class 844 = modern JSON-SVG that everyone actually uses. **bas-sandbox's Phase 1 "Graphics binding lint" should target 844, not 717.**
5. **Cleanup-manifest abstraction** (from OCT's ticket tracker) is a near-perfect match for bas-sandbox's Phase 2 "sandbox edit mode" UX. Worth borrowing the pattern wholesale.

---

## Resolved ROADMAP open questions

`ROADMAP.md` lists 6 open questions. Two of them moved this session:

### Open Q #2 — RESOLVED

> "Block library completeness — the ~30 CCT block IDs without canonical names (526, 528, 555, 556, etc.) need either insider data or empirical inference from real archives."

Resolved by the tcollins2 dictionary contribution series in dbexport-viewer:
- **v0.3.11** — tcollins2 dumped his internal CCT class-ID database, 59 new class IDs verified against a live CCT session screenshot. The exact 526 / 528 / 555 / 556 IDs ROADMAP called out are now named (Input Float Block / Output Float Block / Control Activity / Sensor Primitive respectively, all in `dbexport-viewer/index.html` CLASS_NAMES).
- **v0.3.12** — five top-frequency mystery property IDs named: 4306 Stored Event Enable, 3135 Run In First Group, 721 Restore Command Priority, 52 Limit Enable, 352 Event Message Texts Config.
- **v0.7.D** — bulk import of 3,212 additional property names from OCT's `shared/metasysAttributeNamesByClass.json` (Apache 2.0, full attribution in references/oct-shared/).

Total class-name dictionary: 310 entries. Total property-name dictionary: 3,494 entries (was 282 before v0.7.D). Plus a new `PROP_NAMES_BY_CLASS` map (160 classes, 603 per-class overrides) for properties whose name depends on the class (e.g. prop 12 = "Comment" on points, "Appl SW Version" on devices).

**For bas-sandbox:** if `@velovault/dbexport-parser` mirrors the import, the validator's class-specific rules can target these IDs by name rather than by magic number, and lint output will read as recognizable to a tech.

### Open Q #4 — PARTIALLY RESOLVED

> "License-friendly G36 mapping — ASHRAE documents are public, but pseudocode may have licensing constraints."

Not directly addressed, but: OCT operates the same "factual ID→name mapping is non-copyrightable under Feist v. Rural" theory dbexport-viewer uses for the JCI dictionary harvest. The exact same legal posture applies to ID→name extraction from any vendor or standards body, so the *mechanism* for safe extraction is well-tested at this point — what's left is the substantive G36 pseudocode question, which is genuinely different.

---

## Phase 1 (static validator) — directly portable rules

`ROADMAP.md` Phase 1 lists 8 rules total, 3 shipped (Ref integrity, Suppressed alarms, Duplicate descriptions), 5 pending. The dbexport-viewer session shipped 5 more audit types in v0.7.E that map onto bas-sandbox Phase 1:

| dbexport-viewer rule (v0.7.E) | Maps to bas-sandbox Phase 1 rule | Notes |
|---|---|---|
| Self-references | (new — recommend adding) | Object's own ref appears in its own property value. Rare, but catches legacy import artifacts. |
| Unreferenced objects | (new — recommend adding) | Dead-end orphans with zero incoming refs. Has known-skip set (graphics, user trees, engine roots) you should reuse verbatim. |
| Missing tags / descriptions | (new — recommend adding) | Distinguishes `missingDescription` / `missingName` / `missingBoth`. Has known-skip set for logic primitives. |
| Placeholder names | (new — recommend adding) | Regex against `AI-1` / `point-N` / `untitled-N` etc. — catches "never customized" objects. |
| I/O points missing units | Matches Phase 1's *"Class-specific — AI has units"* exactly | One existing Phase 1 rule, ours has it implemented + tested. |

OCT also runs **11 audit types** per their `SPRINT.md` "Current Notes" section. Those additional ones beyond ours that map onto Phase 1:

- **Duplicate refs** (we lack, OCT has) — same ref appearing in multiple places. Different from our duplicate descriptions.
- **Hotspots** — dependency hotspots (objects referenced by many others). Reverse-lookup count above a threshold. *This is also Phase 2 material.*
- **Orphaned CAF objects** — objects in a `.caf` that have no parent block. Catches refactoring leftovers.

Phase 1 still-pending rules from ROADMAP that the session DIDN'T touch:

- Required-object check (engine root, NIC, security objects) — straightforward, no upstream borrow needed
- Graphics binding lint — **blocked on graphics decoder; see Class 844 note below**
- Programming wire lint — needs TSEGraph parser; dbexport-viewer v0.5.0 has it, could port to parser
- Setpoint sanity (heating SP < cooling SP, deadband > 0) — needs to be built fresh; neither dbexport-viewer nor OCT have this
- Schedule sanity — likewise fresh
- Alarm config (notification class refs resolve, hysteresis where required) — partial overlap with our Ref-integrity scanner, but the *required-config-fields* check is fresh work

**Recommendation:** Port v0.7.E rules and OCT's three extras up to `@velovault/dbexport-parser` as exported functions, then bas-sandbox imports and renders them. Each rule is ~50-100 lines and the row-shape is consistent (`{ ref, className, classId, ...details, _source }`). The whole batch is a single PR against dbexport-parser.

---

## Phase 2 (impact preview, sandbox edit, diff-with-validation) — patterns to borrow

### From dbexport-viewer (already shipped, portable to parser)

- **Reverse-lookup index** — "what references this?" answer. Currently lives in `dbexport-viewer/index.html` as a built-on-demand map. Should be hoisted to `@velovault/dbexport-parser` as a `buildReferenceIndex(archive)` primitive so bas-sandbox can call it for the "right-click → Simulate delete → blast radius" UI.

- **Bulk repoint with confidence pills (v0.3.10)** — "drop the unbound CSV (or scan natively), the tool detects rename patterns, scores them by % of refs that land on real objects, emits a corrected .dbexport." Maps almost 1:1 onto ROADMAP Phase 2's *"Right-click any prefix → 'Simulate rename' → preview the repoint plan with confidence pills"*. The confidence-tier visualization (green ≥80%, yellow 50-80%, red <50%) is in the existing code and worth lifting verbatim.

- **Delete-to-archive (v0.3.10)** — produces an importable corrected `.dbexport` after removing selected items. Maps onto Phase 2's *"Export the modified archive."* Has a categorized confirm dialog pattern (e.g. "5 user trees, 70 graphics, 11 programming logic blocks") that bas-sandbox should mirror for any destructive-action UX.

- **As-Built Documentation generator (v0.3.x)** — produces a printable HTML doc covering site topology, device inventory, point list per controller, schedules, alarm definitions, audit findings. Could be Phase 2's "report" output format directly, or a downstream commercial-tier feature.

### From OCT (Apache 2.0, conceptually borrowable)

- **Cleanup-manifest pattern** (their tickets 007 / 014 / 015) — a structured abstraction where audit findings → manifest of proposed changes → user accepts/rejects per item → dry-run preview → execute. Our dbexport-viewer bulk-fix is direct (find → fix); their staged flow is better UX. **This pattern is a near-perfect match for Phase 2's "sandbox edit mode"** — every edit becomes a manifest entry, the user sees aggregate impact before clicking save, and the export only runs against an explicitly-accepted manifest.

- **Reference cache layer** (their ticket 019) — cache the reverse-lookup index per loaded archive so tab-switching doesn't rebuild. Phase 2 will need this too — every "impact preview" interaction queries the same index.

- **Drillable findings** (consistent pattern across all their audits) — every audit result has a path back to the file and object that caused it. Bas-sandbox should adopt the same `_source` field convention so "click finding → jump to object" is universal across rule types.

---

## Phase 3+ — what's available now or in flight

### TSEGraph parser (v0.5.0 in dbexport-viewer)

Parses `Programming.*.xml` and `.caf`-inner XML control-logic diagrams into `{ nodes, edges, viewBox }`. Currently dbexport-viewer-only; should hoist to `@velovault/dbexport-parser` as `parseTSEGraph(xml)`.

For bas-sandbox:
- **Phase 1 "Programming wire lint"** needs this — every edge has a defined source and target port.
- **Phase 3 topology canvas** could reuse the layout primitives — TSEGraph already encodes node positions and edge waypoints from CCT, so the "drag-and-drop topology canvas" for imported archives starts pre-laid-out.
- **Phase 4 control-logic runtime** — TSEGraph is exactly the wiring graph the runtime needs to walk. The Rust controls layer takes this as input.

### CAF Workspace 5-column layout (v0.6.B in dbexport-viewer, fix in flight as v0.8.F)

Mirrors CCT's actual workspace layout (`Network Inputs → Setpoint → State Generation → Output Control → Network Outputs` + hardware Inputs/Outputs row + Miscellaneous tray). On a real CAF, classifies every object into one of these buckets.

For bas-sandbox: this is potentially the "controller detail view" inside the Phase 3 topology canvas. Click a virtual controller → see its CCT-style workspace. Familiar to any tech.

The bucket-classifier table (currently `CAF_BUCKET_MAP` in dbexport-viewer, 105 classes) should hoist to dbexport-parser since it's a class-ID lookup, not UI code.

### XAML Drawings renderer (v0.6.C in dbexport-viewer)

Renders class 717 / XAML Silverlight graphics → SVG. **This was a strategic misfire** — per OCT's CONTINUITY.md, class 717 is the legacy unrenderable Silverlight format, and class 844 (JSON SVG) is the modern format every current archive uses.

For bas-sandbox: skip the XAML path entirely. Phase 1's "Graphics binding lint" should target class 844. **Sprint G is being scheduled in the dbexport-viewer queue to build the class 844 renderer** — once it lands, it'll be the right ingest layer for the binding-lint rule (every `<reference>` in a class 844 bindings JSON points to something defined in the archive).

### Class dictionary enrichment (v0.6.A in dbexport-viewer)

`CLASS_META` — adds `category` (12 buckets: `CCT — System / BACnet Object / Hardware I/O / Control / Calculation`, `Metasys — Communication / Schedule / N2 Bus / Algorithm / Navigation / Network Engine / System`), `bacnetType` ASHRAE 135 crosswalk for 52 classes, and `context` (SCT / CCT / Both).

For bas-sandbox: directly useful for the Brick mapping in the ingest layer. The category gives a first-pass hint for Brick entity type; the bacnetType crosswalk drives the "what's the standard equivalent of this JCI class?" question that the Brick converter has to answer for every imported object.

Should hoist to dbexport-parser.

---

## Things to push UP to `@velovault/dbexport-parser`

The parser is the bridge. Anything that's currently dbexport-viewer-only and isn't UI code should mirror up. Concrete list:

| Currently in dbexport-viewer | Belongs in dbexport-parser | Why |
|---|---|---|
| `PROP_NAMES` (3,494 entries post-v0.7.D) | yes | bas-sandbox needs property labels |
| `PROP_NAMES_BY_CLASS` map (603 overrides) | yes | per-class refinement |
| `CLASS_META` (category / bacnetType / context) | yes | drives Brick mapping in ingest |
| `CAF_BUCKET_MAP` (105 classes → workspace bucket) | yes | not UI, just a lookup |
| `WORKSPACE_HIDDEN_BUCKET` set (Sprint F in flight) | yes | same |
| `parseTSEGraph(xml)` (v0.5.0) | yes | shared primitive |
| Reverse-lookup index builder | yes | Phase 2's blast-radius UI needs it |
| The 8 audit rules (3 original + 5 from v0.7.E) | yes | each as a pure function returning `Finding[]` |
| Unbound-refs scanner with confidence pills (v0.3.10) | yes | shared primitive |
| Bulk-repoint archive rewriter (v0.3.10) | yes | Phase 2's edit-mode export path |
| Delete-to-archive (v0.3.10) | yes | same |
| Audit row-shape contract | yes | `{ ref, className, classId, ...details, _source }` as a TypeScript type |
| `applyDeletesToArchive(arc, items)` | yes | mutating-but-immutable archive helpers |

What should stay in dbexport-viewer (UI layer):
- Mode dispatch
- Tree rendering, detail panel, tab strip, panel layouts
- Workspace view rendering (the 5-column grid is UI; the classifier is data)
- Drawings / Dictionary views
- Audit pivot UI
- CSV export hooks (the export *format* is shared, but the click-handler wiring is UI)

---

## On the OCT relationship

`thecontrolscompany/oct` is maintained by Tim (`tim@ControlsCo.net`, also `u/tcollins2` on r/BuildingAutomation). His project covers live BACnet commissioning, MS/TP diagnostics, perspective parsing, firmware package browser, and inline graphics rendering — all things bas-sandbox doesn't plan to cover (or covers via WASM simulation rather than live hardware).

His project has a file literally named `DBEXPORT_PARITY.md` that tracks his catch-up against `jmsboswell67-alt/dbexport-viewer`. In CONTINUITY.md he openly cedes archive analysis to dbexport-viewer:

> "OCT goes beyond dbexport-viewer in live BACnet, MS/TP, commissioning, and package workflows. The remaining work is mostly about deep archive analysis and cleanup automation."

This is good for bas-sandbox in two ways:

1. **Non-overlapping scopes.** OCT runs against a live CCT install (requires Windows + SQL Server LocalDB + JCI CCT v18). bas-sandbox runs entirely in-browser with no install. We don't compete with him for the install-and-commission audience; he doesn't compete with us for the design-engineer-and-CxA audience.

2. **Mutually beneficial dictionary harvest.** He pulls live JCI databases (CCT_DB, FDB, DaytonaState) we'd never touch. We curate vendor-neutral semantic intermediate representations he'd never build (Brick mapping, G36 lowering). Apache 2.0 in both directions means dictionary additions flow both ways. We already imported his ~600KB attribute dictionaries (v0.7.D); should mirror to dbexport-parser; bas-sandbox benefits silently.

His project also has things bas-sandbox could borrow that we haven't touched yet:

- **`winproParser.ts`** — parser for WinPro, another legacy JCI controller config format. Niche but real. Could be a Phase 4+ ingest plugin if any user requests it.
- **11-type audit catalog** — additions beyond ours include duplicate refs, hotspots, orphaned CAF objects, placeholder-style name detection, missing units. (Some overlap with our v0.7.E.)
- **SCT database integration** — he reads a DaytonaState SQL database for vendor-specific property names. Not applicable to bas-sandbox (live-DB dependency violates our zero-install pitch) but documents an interesting fact: SCT itself caches the dictionary locally, and a DLL-inspection pipeline could probably extract more.

---

## OSCVT — not relevant to bas-sandbox

Tim also has a separate hardware product called OSCVT (ESP32-S3 BACnet adapter, planned ~$45 vs JCI's $500 dongle). It's adjacent to OCT but completely orthogonal to bas-sandbox. Mentioning it only for context — bas-sandbox never touches live hardware, so OSCVT isn't a competitor, complement, or borrow candidate.

---

## Concrete next-action shortlist for bas-sandbox

In rough priority order, this is what I'd tackle if I were sitting down with bas-sandbox cold tomorrow:

1. **Pull the v0.7.D dictionary expansion into `@velovault/dbexport-parser`.** Single-PR mirror of the OCT-shared import. Bas-sandbox picks up 3,212 property names with no Phase 1 changes required.

2. **Hoist v0.7.E audit rules into the parser as pure functions.** Each rule becomes `auditSelfReferences(archive) → Finding[]` etc. Bas-sandbox imports + renders. Closes most of Phase 1's pending rule list.

3. **Hoist `parseTSEGraph` to the parser.** Unblocks Phase 1's "Programming wire lint" and pre-positions for Phase 3 topology canvas and Phase 4 control runtime.

4. **Borrow OCT's cleanup-manifest pattern for Phase 2 sandbox-edit UX.** Even a sketch in ARCHITECTURE.md helps; full implementation can wait until Phase 2 starts.

5. **Build class 844 / JSON-SVG decoder.** Will land in dbexport-viewer first (Sprint G is queued), then hoist to parser, then bas-sandbox picks it up for the Phase 1 "Graphics binding lint" rule.

6. **Add the OCT URL + DBEXPORT_PARITY.md reference to bas-sandbox's ARCHITECTURE.md acknowledgements section.** Reciprocal credit; OCT already credits dbexport-viewer in their README.

7. **Revisit ROADMAP open questions** — Q#2 should be marked resolved; Q#4 partially. Q#1 (`.caf` runtime semantics) and Q#3 (MS/TP timing fidelity) and Q#5 (WASM EnergyPlus maturity) and Q#6 (commercial line) all still open.

---

## What this file is and isn't

**Is:** a snapshot of what became upstream-available this session and how it could compose into bas-sandbox. Not specs, not commitments.

**Isn't:** a roadmap edit. ROADMAP.md is the source of truth; pick from here what's worth promoting.

If any of this lands in ROADMAP.md or ARCHITECTURE.md, this file has done its job and can be deleted.
