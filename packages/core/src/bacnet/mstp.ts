// MS/TP trunk state — BACnet's RS-485 token-passing protocol.
//
// MS/TP (Master-Slave/Token-Passing) is what most field-level BAS gear
// uses. A trunk is a 2-wire RS-485 daisy-chain with up to 128 device
// addresses (MAC 0-127, though MAC 0 is reserved). Devices pass a token
// around in MAC-address order — only the token-holder can transmit.
//
// At 38400 baud (the default), each device gets the token for ~50-200ms
// depending on traffic, and a full token rotation on a 32-device trunk
// takes ~1-2 seconds. Lost tokens (device offline) cost ~500ms recovery.
//
// We model:
//   - MAC address assignment (deterministic from canvas device order)
//   - Token-holder index (which MAC currently owns the bus)
//   - Rotation count (whole loops around the ring)
//   - Time-on-token per device (how long until the token moves)
//
// First-cut: every device gets equal token time. Real MS/TP has retries,
// Poll-For-Master, and node-skipping when devices go offline — those
// come in N.2 when we model actual packets.

export interface MstpDevice {
  /** Canvas node id of the device on this trunk. */
  readonly nodeId: string;
  /** MAC address (0-127). MAC 0 conventionally for the master/supervisor. */
  readonly mac: number;
  /** Display label — node name for the panel. */
  readonly label: string;
  /** BACnet Device Instance number (0-4194302). Distinct from the MAC:
   *  the MAC routes link-layer frames on this trunk, but the device
   *  instance is the network-wide identifier returned in an I-Am and
   *  used by upstream supervisors to address this device across BBMDs.
   *  When omitted we synthesize a default of `1000 + mac` for display. */
  readonly deviceInstance?: number;
}

/** Convenience for the default device-instance scheme. */
export function defaultDeviceInstance(mac: number): number {
  return 1000 + mac;
}

export interface MstpTrunkState {
  /** Devices in MAC-address order (the token ring). */
  readonly devices: readonly MstpDevice[];
  /** Index into devices[] of the current token holder. */
  readonly tokenIndex: number;
  /** How many sim-seconds have elapsed since this device got the token. */
  readonly timeOnToken: number;
  /** Completed token rotations since the trunk came online. */
  readonly rotations: number;
  /** Baud rate (drives token-pass cadence). */
  readonly baud: number;
}

/** Default time per device per token-hold cycle, in seconds. At 38400
 *  baud with a typical 32-device trunk, full rotation ≈ 1.5s → each
 *  device gets ~50ms. We scale linearly with baud so 76800 = half time. */
export function tokenHoldSeconds(baud: number): number {
  const baseBaud = 38400;
  return 0.05 * (baseBaud / Math.max(9600, baud));
}

/** Round-trip time for a single BACnet confirmed-service exchange
 *  (ReadProperty / WriteProperty / SubscribeCOV → ACK), in seconds.
 *
 *  Model:
 *    - frame_ms = 30 bytes × 10 bits/byte × 1000 / baud  (typical service)
 *    - request frame + response frame + ~50ms token-wait queue
 *
 *  Numbers at common bauds:
 *    9600  →   ~112 ms   (slow trunks really do feel sluggish)
 *    19200 →    ~81 ms
 *    38400 →    ~66 ms   (the BAS default)
 *    76800 →    ~58 ms
 *
 *  BACnet/IP isn't gated by token-passing — flat ~15ms RTT covers
 *  switch latency + stack overhead for typical LAN traffic. */
export function mstpServiceLatencySeconds(baud: number): number {
  const frameSeconds = (30 * 10) / Math.max(9600, baud);
  // request + response + half-token-hold queue
  return frameSeconds * 2 + 0.05;
}

/** BACnet/IP round-trip estimate — flat because Ethernet doesn't have
 *  the token-wait queue. */
export const BACNET_IP_RTT_SECONDS = 0.015;

/** Advance a token by `dt` sim-seconds. Handles multiple hops per tick
 *  if the elapsed time exceeds the per-device hold window — important
 *  when sim is running at 30× / 300× speed. */
export function stepMstpToken(state: MstpTrunkState, dt: number): MstpTrunkState {
  if (state.devices.length === 0) return state;
  const hold = tokenHoldSeconds(state.baud);
  let timeOnToken = state.timeOnToken + dt;
  let tokenIndex = state.tokenIndex;
  let rotations = state.rotations;
  while (timeOnToken >= hold && state.devices.length > 1) {
    timeOnToken -= hold;
    tokenIndex = (tokenIndex + 1) % state.devices.length;
    if (tokenIndex === 0) rotations += 1;
  }
  return {
    devices: state.devices,
    tokenIndex,
    timeOnToken,
    rotations,
    baud: state.baud,
  };
}

/** Initial state for a fresh trunk — token starts at MAC 0 (the master). */
export function initMstpTrunkState(devices: readonly MstpDevice[], baud: number = 38400): MstpTrunkState {
  return {
    devices,
    tokenIndex: 0,
    timeOnToken: 0,
    rotations: 0,
    baud,
  };
}

/** Pretty-print "DEV-1 (MAC 3)". */
export function formatMstpDevice(d: MstpDevice): string {
  return `${d.label} (MAC ${d.mac})`;
}

// ── Deterministic MAC assignment ────────────────────────────────────────
// Grouping MS/TP edges into trunks and assigning each device a MAC is
// pure topology math — no sim state. Factored out here so the UI tick,
// any GUI-facing derived (the canvas node badge), and the inspector all
// read ONE address map and can never drift from the packet log.

/** Minimal node shape the addressing algorithm needs. Decoupled from the
 *  UI node type so this stays a pure, testable core function. */
export interface MstpAddressingNode {
  readonly id: string;
  readonly label: string;
  /** Node kind — only `'supervisor'` is special-cased (MAC-0 candidate). */
  readonly kind: string;
  /** Explicit MAC override (dip-switch). Always wins when set. */
  readonly forcedMac?: number;
  /** Explicit device-instance override. Falls back to `1000 + mac`. */
  readonly deviceInstance?: number;
  /** RS-485 end-of-line termination (the EOL dip switch / resistor).
   *  undefined = not modeled on this device yet; true/false = the user
   *  (or a scenario) explicitly set the switch. The topology validator
   *  checks that exactly the two physical chain ends are terminated. */
  readonly eolTerminated?: boolean;
}

/** Minimal edge shape: `wireKind` distinguishes MS/TP segments (`'mstp'`)
 *  from BACnet/IP uplinks (`'bacnet-ip'`); `baud` is the segment speed. */
export interface MstpAddressingEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly wireKind?: string;
  readonly baud?: number;
}

/** One MS/TP trunk (a connected component of `'mstp'` edges) with its
 *  devices MAC-assigned and sorted into token-ring (MAC) order. */
export interface MstpTrunkAddressing {
  /** Representative edge id — the trunk's stable key (used as `trunkId`
   *  on every packet emitted for this segment). */
  readonly trunkKey: string;
  readonly baud: number;
  readonly devices: readonly MstpDevice[];
}

export interface MstpAddressingResult {
  readonly trunks: readonly MstpTrunkAddressing[];
  /** Flat nodeId → device lookup (with owning trunk key) for callers that
   *  need a single node's address, e.g. a canvas badge. */
  readonly byNode: ReadonlyMap<string, MstpDevice & { readonly trunkKey: string }>;
}

const DEFAULT_MSTP_BAUD = 38400;

/**
 * Group MS/TP edges into trunks and assign each device a MAC address +
 * device instance, deterministically, from topology alone.
 *
 * Mirrors what a commissioning tech sees on the bus:
 *   - Trunks are connected components over `wireKind: 'mstp'` edges.
 *   - Within a trunk MAC 0 (the master / token originator) is the first
 *     of: a node with `forcedMac === 0`, a `supervisor`, a node with a
 *     BACnet/IP uplink (the edge router bridging IP → MS/TP), else the
 *     lowest-label node.
 *   - `forcedMac` always wins (a real dip-switch). Everyone else takes
 *     the next free child MAC in label order.
 *   - Device instance honors an explicit override, else `1000 + mac`.
 */
/** One physical MS/TP segment as a graph: its member node ids, the MS/TP
 *  edges between them, and the trunk's stable key (representative edge id).
 *  Shared by addressing AND the topology validator so trunk identity can
 *  never drift between the two. */
export interface MstpComponent {
  /** Stable trunk key — the lowest-listed member edge's id. */
  readonly trunkKey: string;
  readonly nodeIds: readonly string[];
  readonly edges: readonly MstpAddressingEdge[];
}

/** Group `wireKind: 'mstp'` edges into connected components (physical
 *  trunks). Undirected — a bus has no in/out. */
export function mstpComponents(
  edges: readonly MstpAddressingEdge[],
): MstpComponent[] {
  const mstpEdges = edges.filter((e) => e.wireKind === 'mstp');

  // Adjacency over MS/TP wires → connected components (trunks).
  const adj = new Map<string, Set<string>>();
  for (const e of mstpEdges) {
    if (!e.source || !e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  const visited = new Set<string>();
  const out: MstpComponent[] = [];
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const group: string[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      group.push(cur);
      for (const nb of adj.get(cur) ?? []) if (!visited.has(nb)) stack.push(nb);
    }
    const memberEdges = mstpEdges.filter(
      (e) => group.includes(e.source) && group.includes(e.target),
    );
    if (memberEdges.length === 0) continue;
    out.push({ trunkKey: memberEdges[0].id, nodeIds: group, edges: memberEdges });
  }
  return out;
}

export function assignMstpAddressing(
  nodes: readonly MstpAddressingNode[],
  edges: readonly MstpAddressingEdge[],
): MstpAddressingResult {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const components = mstpComponents(edges);

  const hasBacnetIpUplink = (nodeId: string): boolean =>
    edges.some(
      (e) => e.wireKind === 'bacnet-ip' && (e.source === nodeId || e.target === nodeId),
    );

  const trunks: MstpTrunkAddressing[] = [];
  const byNode = new Map<string, MstpDevice & { trunkKey: string }>();

  for (const comp of components) {
    const baud = comp.edges[0]?.baud ?? DEFAULT_MSTP_BAUD;

    // Sort by label so MAC assignment is deterministic across renders.
    // Field devices (sensors, safeties, actuators) are dumb hardwired
    // endpoints — they have no RS-485 transceiver and never take a MAC or
    // device-instance, even if a learner mis-wires one onto an MS/TP trunk
    // in Realistic mode. They stay in the connectivity graph (so the trunk
    // still forms between the real BACnet devices) but are excluded here so
    // they don't masquerade as networked peers.
    const trunkNodes = comp.nodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is MstpAddressingNode => !!n)
      // Zones (rooms) and equipment (fans/coils/boilers) aren't BACnet
      // devices either — a duct or pipe drawn as an MS/TP wire must not
      // hand the ROOM a MAC address.
      .filter(
        (n) =>
          n.kind !== 'sensor' &&
          n.kind !== 'safety' &&
          n.kind !== 'actuator' &&
          n.kind !== 'zone' &&
          n.kind !== 'equipment',
      )
      .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));

    const forcedZero = trunkNodes.find((n) => n.forcedMac === 0);
    const supervisorOnTrunk = trunkNodes.find((n) => n.kind === 'supervisor');
    const routerOnTrunk = trunkNodes.find((n) => hasBacnetIpUplink(n.id));
    const masterNode = forcedZero ?? supervisorOnTrunk ?? routerOnTrunk ?? null;

    let nextChildMac = 1;
    const devices: MstpDevice[] = trunkNodes.map((n) => {
      let mac: number;
      if (typeof n.forcedMac === 'number') mac = n.forcedMac;
      else if (masterNode && n.id === masterNode.id) mac = 0;
      else mac = nextChildMac++;
      const instanceOverride = n.deviceInstance;
      return {
        nodeId: n.id,
        mac,
        label: n.label || n.id,
        deviceInstance:
          typeof instanceOverride === 'number' && Number.isFinite(instanceOverride)
            ? instanceOverride
            : defaultDeviceInstance(mac),
      };
    });
    // Token ring is MAC-ordered.
    devices.sort((a, b) => a.mac - b.mac);

    trunks.push({ trunkKey: comp.trunkKey, baud, devices });
    for (const d of devices) byNode.set(d.nodeId, { ...d, trunkKey: comp.trunkKey });
  }

  return { trunks, byNode };
}
