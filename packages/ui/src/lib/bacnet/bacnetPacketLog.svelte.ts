// BACnet packet log — Wireshark-style stream of wire-level events.
//
// Two layers of traffic flow through here:
//
//   1. MS/TP link-layer: Token-Pass packets — every time the token hops
//      between MACs, the prior holder transmits a "here you go" frame to
//      the next holder. Reflects what you'd see on a sniffer dongle on
//      the RS-485 bus.
//
//   2. BACnet application-layer: ReadProperty / I-Am / Who-Is — the
//      supervisor (MAC 0) periodically polls its downstream controllers
//      for live AI values. The sim synthesizes these as canned exchanges:
//      a request packet from MAC 0 → child MAC, then an ACK with the
//      live PresentValue one tick later. They're not "real" BACnet bytes
//      on the wire, but the timing, source/dest, service, object id,
//      and value all match what a tech would see in YABE's packet view.
//
// Bounded ring buffer (default 500 entries) so a 300×-speed marathon
// doesn't eat memory. Like the runtime log, this is its own dedicated
// store so callers (the panel + tests) can read it without depending on
// BuildCanvas internals.

export type BacnetService =
  | 'Token-Pass'
  | 'Poll-For-Master'
  | 'I-Am'
  | 'Who-Is'
  | 'ReadProperty'
  | 'ReadProperty-ACK'
  | 'WriteProperty'
  | 'WriteProperty-ACK'
  // Change-of-Value: the production pattern. Supervisor subscribes once,
  // controller pushes a notification only when the subscribed value
  // crosses its deadband. Idle bus until something actually moves.
  | 'SubscribeCOV'
  | 'SubscribeCOV-ACK'
  | 'ConfirmedCOVNotification';

export interface BacnetPacket {
  readonly id: number;
  /** Sim seconds when this packet was emitted. */
  readonly simSec: number;
  /** Trunk identifier (the representative edge id). Lets the panel filter
   *  by trunk when the canvas has multiple MS/TP segments. */
  readonly trunkId: string;
  /** Friendly trunk label (e.g. "FEC trunk · 38400") for display. */
  readonly trunkLabel?: string;
  readonly srcMac: number;
  /** Destination MAC. Token-Pass + ReadProperty/WriteProperty have a
   *  specific destination; Who-Is is broadcast (undefined). */
  readonly dstMac?: number;
  readonly service: BacnetService;
  /** Object reference for application-layer packets, e.g. "AI:3". */
  readonly objectId?: string;
  /** ReadProperty / WriteProperty value, when applicable. */
  readonly value?: number | boolean;
  /** Pretty-printed summary cell for the panel. */
  readonly summary: string;
  /** Optional category for filter coloring. */
  readonly layer: 'link' | 'app';
}

export type LayerFilter = 'all' | 'link' | 'app';

interface PacketLogStore {
  packets: BacnetPacket[];
  panelOpen: boolean;
  paused: boolean;
  layerFilter: LayerFilter;
  /** Trunk id filter; '' = show all trunks. */
  trunkFilter: string;
  offsetX: number;
  offsetY: number;
}

const MAX_PACKETS = 500;
const LS_POSITION = 'bas-sandbox.bacnet-log.position.v1';
const LS_PANEL_OPEN = 'bas-sandbox.bacnet-log.open.v1';

function loadStoredPosition(): { x: number; y: number } {
  if (typeof localStorage === 'undefined') return { x: 0, y: 0 };
  try {
    const raw = localStorage.getItem(LS_POSITION);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as { x: number; y: number };
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
  } catch {
    // ignore
  }
  return { x: 0, y: 0 };
}

function loadPanelOpen(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(LS_PANEL_OPEN) === '1';
  } catch {
    return false;
  }
}

const _initialPos = loadStoredPosition();

export const bacnetPacketLog = $state<PacketLogStore>({
  packets: [],
  // Panel starts closed by default — the runtime log is the more general
  // surface; the packet log is opt-in once the user wants to watch wires.
  panelOpen: loadPanelOpen(),
  paused: false,
  layerFilter: 'all',
  trunkFilter: '',
  offsetX: _initialPos.x,
  offsetY: _initialPos.y,
});

let nextId = 1;

/** Append a packet. Drops oldest when buffer is full. No-op when paused. */
export function logPacket(p: Omit<BacnetPacket, 'id'>): void {
  if (bacnetPacketLog.paused) return;
  bacnetPacketLog.packets.push({ ...p, id: nextId++ });
  if (bacnetPacketLog.packets.length > MAX_PACKETS) {
    bacnetPacketLog.packets = bacnetPacketLog.packets.slice(-MAX_PACKETS);
  }
}

export function clearPackets(): void {
  bacnetPacketLog.packets = [];
}

export function togglePanel(): void {
  bacnetPacketLog.panelOpen = !bacnetPacketLog.panelOpen;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_PANEL_OPEN, bacnetPacketLog.panelOpen ? '1' : '0');
  } catch {
    // ignore
  }
}

export function togglePaused(): void {
  bacnetPacketLog.paused = !bacnetPacketLog.paused;
}

export function setLayerFilter(f: LayerFilter): void {
  bacnetPacketLog.layerFilter = f;
}

export function setTrunkFilter(id: string): void {
  bacnetPacketLog.trunkFilter = id;
}

// See runtimeLogStore for the rationale — must be large enough that the
// panel's drag handle can't end up under the app header + BuildCanvas's
// own top toolbar (sim controls, network pill, clock). 360px is safe.
const PANEL_MIN_HEADER_VISIBLE = 360;

function clampToViewport(x: number, y: number): { cx: number; cy: number } {
  if (typeof window === 'undefined') return { cx: Math.max(0, x), cy: Math.max(0, y) };
  const maxY = Math.max(0, window.innerHeight - PANEL_MIN_HEADER_VISIBLE);
  const maxX = Math.max(0, window.innerWidth - PANEL_MIN_HEADER_VISIBLE);
  return {
    cx: Math.min(maxX, Math.max(0, x)),
    cy: Math.min(maxY, Math.max(0, y)),
  };
}

export function setPanelPosition(x: number, y: number): void {
  const { cx, cy } = clampToViewport(x, y);
  bacnetPacketLog.offsetX = cx;
  bacnetPacketLog.offsetY = cy;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_POSITION, JSON.stringify({ x: cx, y: cy }));
  } catch {
    // ignore
  }
}

export function resetPanelPosition(): void {
  setPanelPosition(0, 0);
}

export function rehydratePanelPosition(): void {
  const { cx, cy } = clampToViewport(bacnetPacketLog.offsetX, bacnetPacketLog.offsetY);
  if (cx !== bacnetPacketLog.offsetX || cy !== bacnetPacketLog.offsetY) {
    setPanelPosition(cx, cy);
  }
}

/** Visible packets after applying layer + trunk filters. */
export function visiblePackets(): BacnetPacket[] {
  let arr = bacnetPacketLog.packets;
  if (bacnetPacketLog.layerFilter !== 'all') {
    arr = arr.filter((p) => p.layer === bacnetPacketLog.layerFilter);
  }
  if (bacnetPacketLog.trunkFilter) {
    arr = arr.filter((p) => p.trunkId === bacnetPacketLog.trunkFilter);
  }
  return arr;
}

/** Unique trunk ids currently represented in the buffer — used to
 *  populate the per-trunk filter dropdown. */
export function trunkIdsInBuffer(): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const p of bacnetPacketLog.packets) {
    if (!seen.has(p.trunkId)) seen.set(p.trunkId, p.trunkLabel ?? p.trunkId);
  }
  return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
}

/** Pretty-print a packet for one-line display.
 *  `MAC 0 → MAC 3  ReadProperty AI:1 = 72.3`  */
export function formatPacket(p: BacnetPacket): string {
  const dst = p.dstMac !== undefined ? `MAC ${p.dstMac}` : 'broadcast';
  const head = `MAC ${p.srcMac} → ${dst}  ${p.service}`;
  return p.objectId ? `${head} ${p.objectId}` : head;
}
