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
