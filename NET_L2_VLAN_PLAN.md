# Plan — Layer-2 switches + VLANs (Net.L2)

Status: **proposed, not started.** Author: James + Claude, 2026-06-09.
Scope owner: this doc covers the L2 switch + VLAN track only (the "A2" track
from the lay-of-the-land discussion). Firewall/ACL (A1) and AO/BO priority
array (B3) are separate tracks and explicitly out of scope here — though this
work lays the segmentation substrate the firewall track later sits on top of.

---

## 1. Why this, and the teaching payoff

Real BAS/HVAC techs get burned by the network's **second** layer, not just the
third. They understand "wrong IP" (the sandbox already validates that well in
[`ipv4.ts`](packages/core/src/bacnet/ipv4.ts)). What corners them on bigger
jobs — data centers, hospitals, anything with an IT department — is:

- "The JACE has a perfect IP and mask, the supervisor has a perfect IP and
  mask, they're on the same subnet… and they still can't see each other."
  Because the switch port the JACE is plugged into is on the **corporate
  VLAN**, not the **BMS VLAN**.
- "It worked at my desk, broke in the IDF." Because the uplink **trunk**
  between the two switches doesn't carry the BMS VLAN.
- "Half my controllers dropped after IT 'cleaned up' the switch." Native-VLAN
  / untagged-traffic mistakes.

No other BAS trainer teaches this. It's the #1 IT/OT friction point and techs
currently learn it only by taking down a customer's site. That's the product
wedge.

**The one-sentence demo we're building toward:** drop two VLANs, plug a
supervisor into the BMS VLAN and a "site director laptop" into the corporate
VLAN, hit play, and watch the Who-Is broadcast from the supervisor **reach the
BMS controllers but die at the VLAN boundary** before it ever gets to the
laptop — with a finding that says exactly why and exactly which port to fix.

---

## 2. The conceptual model we're adding

The sandbox today models L3 (IP/subnet) and the BACnet app layer well. It does
**not** model L2 (the switch fabric). Today a `bacnet-ip` edge drawn
device→device is an implicit "these two are on the same wire." We're adding the
switch fabric *underneath* that.

Key concepts, in tech-recognizable terms:

| Concept | What it is | How we model it |
|---|---|---|
| **Switch** | The box every device actually plugs into | New node kind `switch` |
| **Port** | One RJ45 jack on the switch | Entry in `switch.data.ports[]` |
| **Access port** | Carries exactly one VLAN, untagged. Where end devices plug in. | `port.mode: 'access'`, `port.accessVlan: N` |
| **Trunk port** | Carries many VLANs, tagged (802.1Q). Switch-to-switch uplinks. | `port.mode: 'trunk'`, `port.trunkVlans: N[]`, `port.nativeVlan: N` |
| **VLAN** | A broadcast domain. Devices on different VLANs can't talk at L2. | A VLAN id (int) + optional name; the canvas's existing **subnet zone** optionally carries a `vlanId` to tie VLAN↔subnet↔drawn-region together |
| **Broadcast domain** | The set of devices a Who-Is can actually reach | **Computed** from switch topology + VLAN membership |

Two facts we want a tech to internalize, both surfaced by the validator:

1. **VLAN ≠ subnet, but they should agree.** A VLAN is L2 segmentation; a
   subnet is L3 addressing. In a sane install they map 1:1 (VLAN 10 =
   10.0.1.0/24). The classic real-world bug is a device whose IP belongs to one
   subnet but whose switch port is on the *other* VLAN. We flag that.
2. **Same subnet does not mean reachable.** Two devices can share a subnet/mask
   and still be unreachable because they're on different VLANs. The existing
   `ipv4.subnet-mismatch` check looks correct (both /24, same net) yet comms
   fail — the L2 layer is the missing half of the explanation.

---

## 3. Scope

**In scope (Net.L2):**

- `switch` node kind with a configurable port table.
- Access/trunk port semantics; per-port VLAN assignment; trunk allowed-VLAN
  lists + native VLAN.
- Optional `vlanId` on subnet zones (ties the existing CIDR region to a VLAN).
- A pure L2/VLAN validator in core with a focused findings list (§5).
- Broadcast-domain computation, fed into the **existing** Net.5 Who-Is
  broadcast trace so broadcasts visibly stop at VLAN boundaries.
- Switch inspector UI (port table) + VLAN badges on device cards/edges.
- 2 demo scenarios.

**Deliberately out of scope (note it, don't build it):**

- Firewall / ACL / per-port-protocol blocking (UDP 47808) — that's track A1.
  L2/VLAN gives it the segmentation model to sit on; we stop at "different
  VLANs are isolated," not "this rule drops this port."
- Spanning Tree / loop detection, LACP/port-channels, PoE budgets, MAC-address
  tables, QoS. Real, but not what teaches the IT/OT BACnet lesson.
- Inter-VLAN routing config depth beyond "is there a router/SVI on both VLANs
  or not." Full routing tables stay in the L3 router track.

**Backward compatibility:** switches are **optional**. A canvas with no switch
node behaves exactly as today (direct device↔device `bacnet-ip` edges =
implicit same broadcast domain). The L2 validator only engages its
domain-partition logic when at least one `switch` node is present.

---

## 4. Data model

Mirrors the existing patterns so it drops into the current tick/validator flow
with no new plumbing concepts.

### 4.1 Switch node (`node.data`)

```ts
type SwitchPortMode = 'access' | 'trunk';

interface SwitchPort {
  id: string;            // "p1", "p2" … used as the xyflow targetHandle
  label?: string;        // optional ("Gi1/0/3")
  mode: SwitchPortMode;
  // access:
  accessVlan?: number;   // required when mode === 'access'
  // trunk:
  trunkVlans?: number[]; // allowed VLANs; required when mode === 'trunk'
  nativeVlan?: number;   // untagged VLAN on a trunk (default 1)
}

interface SwitchData {
  kind: 'switch';
  label: string;
  ports: SwitchPort[];
  // optional management IP so the switch itself can be a validated device
  ipAddress?: string;
  subnetMask?: string;
  gateway?: string;
}
```

Reuses the **router-interface inspector pattern** (`routerInterfaces[]` editing
in BuildCanvas) for the port table editor, and the **terminal-handle pattern**
(`sourceHandle`/`targetHandle` already used to wire a sensor into a specific
`UI-2`) so a device-to-switch edge targets a specific port.

### 4.2 Edge changes

A device↔switch edge is a `bacnet-ip` (or future `ethernet`) edge whose
`targetHandle` is the switch port id. No new edge fields strictly required —
the port (and therefore the VLAN) is looked up on the switch by handle. We may
add `edge.data.linkRole?: 'access' | 'uplink'` purely for rendering.

### 4.3 Subnet zone gains an optional VLAN

```ts
type SubnetZoneData = {
  kind: 'subnet-zone';
  label: string;
  cidr: string;
  color: string;
  vlanId?: number;   // NEW — ties this drawn subnet to a VLAN id
};
```

This is what lets us cross-check "device's access-port VLAN" vs "the
subnet/CIDR its IP lives in," and gives the canvas a colored VLAN region for
free.

### 4.4 What the validator consumes (pure inputs, like the others)

```ts
interface L2Switch {
  nodeId: string;
  label: string;
  ports: SwitchPort[];
}
interface L2Link {            // an edge as the L2 sees it
  edgeId: string;
  aNodeId: string; aHandle?: string;   // port id if endpoint is a switch
  bNodeId: string; bHandle?: string;
}
interface L2Device {
  nodeId: string;
  label: string;
  ipAddress?: string;
  subnetMask?: string;
  isSwitch: boolean;
}
interface VlanDef {           // derived from zones with vlanId
  vlanId: number;
  cidr?: string;
  label?: string;
}
```

---

## 5. The validator (core) — `packages/core/src/bacnet/l2vlan.ts`

Pure, deterministic, unit-tested — same contract as `validateBacnetIpNetwork`.
Returns `L2Finding[]` reusing the existing `severity / title / description /
nodeIds / edgeIds` finding shape so the health pill, runtime-log de-dup, and
findings panel pick it up with zero changes.

Findings (initial set):

| id | sev | Fires when | The lesson |
|---|---|---|---|
| `l2.access-port-no-vlan` | error | access port wired to a device but `accessVlan` unset | "every access port needs a VLAN" |
| `l2.endpoint-on-wrong-port-mode` | warning | end device on a trunk port, or switch-uplink on an access port | access vs trunk basics |
| `l2.vlan-isolated-pair` | error | two devices wired (or expected to talk) end up in **different** broadcast domains | "same subnet, different VLAN = no comms" |
| `l2.trunk-missing-vlan` | error | switches A↔B trunked, a VLAN exists on both but the trunk's `trunkVlans` omits it | the IDF-uplink classic |
| `l2.native-vlan-mismatch` | warning | two ends of a trunk disagree on `nativeVlan` | untagged-traffic / VLAN-hop risk |
| `l2.ip-vlan-subnet-mismatch` | error | device IP not in the CIDR of the zone whose `vlanId` matches its access VLAN | "IP says VLAN 10, port says VLAN 20" |
| `l2.inter-vlan-no-router` | warning | devices on VLAN A and VLAN B are expected to talk but no router/SVI has interfaces on both | inter-VLAN routing needs an L3 hop |
| `l2.vlan-no-devices` | info | a defined VLAN/zone has no member devices | catches stale/typo VLANs |

Core helper, reused by both the validator and the broadcast trace:

```ts
// Partition devices into VLAN broadcast domains given the switch fabric.
// Walks switch↔switch trunks honoring allowed-VLAN lists, groups access
// ports by VLAN. Returns Map<vlanId, Set<nodeId>> plus an "unswitched"
// domain for any device on a direct device↔device edge (back-compat).
function computeBroadcastDomains(
  switches: L2Switch[], devices: L2Device[], links: L2Link[],
): { domains: Map<number, Set<string>>; unswitched: Set<string> };
```

---

## 6. UI changes

1. **Palette** — add a "Switch" tile to [`NetworkPalette.svelte`](packages/ui/src/lib/network/NetworkPalette.svelte)
   using the existing `application/bas-node-kind` drag MIME (`kind: 'switch'`).
   Glyph: a stack/▤. Add it to the live-inventory counter alongside
   zones/routers/bbmds.
2. **Node glyph + kind** — register `switch` in the `Kind` union
   (BuildCanvas:299) and give [`BasNode.svelte`](packages/ui/src/lib/BasNode.svelte)
   a switch rendering with port stubs along the bottom edge (handles).
3. **Switch inspector** — a port table (add/remove port; per-port mode select;
   access-VLAN field or trunk allowed-VLANs + native-VLAN). Clone the
   `routerInterfaces` editor block in BuildCanvas almost verbatim.
4. **VLAN affordances** — VLAN id badge on each device card (derived from its
   access port); color device/zone by VLAN; a small "VLAN N" pill on access
   edges. Subnet-zone inspector gains an optional VLAN-id field.
5. **Findings** — flow automatically into the network-health pill + runtime log
   via the existing `publishIpv4Findings`-style path; add the L2 findings to
   the same array built in the tick loop (BuildCanvas ~3380).

---

## 7. Broadcast-trace integration (the payoff)

The Net.5 broadcast trace already synthesizes a Who-Is from each supervisor and
logs per-destination routing outcomes (BuildCanvas ~3435,
`announcedBroadcastTrace`). Extend it to consult `computeBroadcastDomains`:

- Who-Is reaches every device in the **same** broadcast domain → normal.
- A device in a **different VLAN** is logged as
  `DROPPED at VLAN boundary (src VLAN 10 → dst VLAN 20, no inter-VLAN route)`.
- If a router/SVI bridges the two VLANs AND BBMDs exist, it's logged as routed
  (composes with the existing BBMD logic — VLAN isolation is checked *before*
  the BBMD/router checks, since L2 is below L3).

This makes the lesson visible in the packet log, not just the findings panel.

---

## 8. Demo scenarios (`demoScenarios.ts`)

1. **"Corporate vs BMS VLAN — port on the wrong VLAN."** One switch, two VLANs
   (10 = BMS / 10.0.1.0/24, 20 = Corp / 10.0.2.0/24). Supervisor + 3
   controllers on VLAN-10 access ports; a "Site Director laptop" on a VLAN-20
   port. The supervisor *also* mistakenly has one controller on a VLAN-20 port
   → `l2.vlan-isolated-pair` + the Who-Is trace shows it never gets discovered.
2. **"Two IDFs, trunk forgot the BMS VLAN."** Two switches trunked; VLAN 10
   exists on both, but the uplink `trunkVlans` lists only [1,20]. Controllers
   on switch-B/VLAN-10 vanish from switch-A's supervisor →
   `l2.trunk-missing-vlan`. Fix the trunk, hit play, they appear.

Both use the existing `SpecNode`/`SpecEdge` builder; switches need the new
`kind: 'switch'` + `data.ports`, and edges need `targetHandle` = port id (the
builder already supports `sourceHandle`/`targetHandle`).

---

## 9. Implementation slices (vertical, shippable in order)

- **L2.1 — Core model + validator.** `l2vlan.ts`: types,
  `computeBroadcastDomains`, all §5 findings, full unit-test suite. No UI.
  *(This is the slice I'd build first — pure, testable, no canvas risk.)*
- **L2.2 — Palette tile + switch node glyph + drop handler.**
- **L2.3 — Switch inspector (port table) + device→port wiring via handle.**
- **L2.4 — Wire validator into the tick loop; findings in pill/log; VLAN
  badges; zone `vlanId` field.**
- **L2.5 — Broadcast-domain → Who-Is trace integration.**
- **L2.6 — Two demo scenarios.**

Each slice keeps the app green (typecheck + the 164 unit tests) and is
demoable on its own.

---

## 10. Open decisions for James to confirm on review

1. **Port model granularity.** Plan models an explicit `ports[]` array on the
   switch (realistic — a switch has 24 ports whether wired or not) and wires
   devices to a specific port via handle. Cheaper alternative: VLAN lives
   directly on the access edge (`edge.data.accessVlan`) with no explicit port
   objects. The explicit-port model teaches more (you see the port config the
   way you would in the switch's web UI) but is more UI. **Recommend explicit
   ports.** Agree?
2. **VLAN↔subnet coupling.** Make `vlanId` on a zone the single source of the
   VLAN↔CIDR mapping (clean, visual), vs. a separate VLAN-definition table
   decoupled from zones (more flexible, more UI). **Recommend zone-coupled.**
3. **Default port count** for a freshly dropped switch (e.g. 8 access ports on
   VLAN 1 + 1 trunk), so it's not an empty box. Number?
4. **Switch self-as-device.** Should the switch's own management IP participate
   in the existing IPv4 validator (duplicate-IP etc.)? **Recommend yes** — it's
   a real device with an IP that techs misconfigure.
5. **Naming.** Call the layer "VLAN / switching," "L2," or "Network
   segmentation" in the UI? (Affects the palette section header + findings
   prose voice.)

---

## 11. Testing

- Unit tests for `computeBroadcastDomains` (single switch multi-VLAN; trunked
  switches with/without the VLAN; direct-edge back-compat; isolated device).
- Unit tests per finding id (positive + negative case each), matching the
  existing `ipv4.ts` test style.
- One integration check: the two demo scenarios load, validate to the expected
  finding set, and the Who-Is trace reports the expected drop.
- `pnpm typecheck` + full unit suite stay green at every slice boundary.
