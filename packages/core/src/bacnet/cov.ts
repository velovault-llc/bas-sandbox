// COV subscription lifecycle — lease, renewal, and scan-cadence math.
//
// Every constant and rule in this file is ground-truthed against real-stack
// captures from the lab rig (tools/real-bacnet-rig/, 2026-06-10):
//
// - lab3 (bacserv 1.4.1): devices send an INITIAL notification with the
//   current value 0.2–7 s after every (re)subscribe — a subscriber always
//   learns the starting value via COV (G47). Change detection is SCAN-based
//   against the last value NOTIFIED, on the same 0.2–7 s cadence — rapid
//   intermediate writes never hit the wire (G49).
// - lab4 (YABE client): default lifetime 120 s, with the client re-subscribing
//   at EXACTLY lifetime/2 — a periodic SubscribeCOV+ACK heartbeat (G48).
// - lab7c (bacpypes3, TTL ghost): a device whose subscriber vanished kept
//   notifying into the void and went silent at lease+115.3 s of a 120 s
//   lease — TTL honored to within one notification interval (G48 expiry).

/** YABE's default subscription lifetime; also the lab7c lease length. */
export const COV_LIFETIME_DEFAULT_S = 120;

/** Clients renew at exactly lifetime/2 (observed every cycle in lab4). */
export const COV_RENEWAL_FRACTION = 0.5;

/** bacserv's observed COV scan-latency band (lab3: 0.2–7 s, ~12 samples). */
export const COV_SCAN_MIN_S = 0.2;
export const COV_SCAN_MAX_S = 7;

export interface CovLease {
  /** Sim-time when the (re)subscribe was sent. */
  readonly subscribedAtSimSec: number;
  /** Lease length in seconds. 0 = indefinite (spec-legal; never expires). */
  readonly lifetimeSeconds: number;
}

/** Sim-time at which the subscriber should re-subscribe (lifetime/2). */
export function covRenewalDueAt(lease: CovLease): number {
  return lease.subscribedAtSimSec + lease.lifetimeSeconds * COV_RENEWAL_FRACTION;
}

/** Sim-time at which an un-renewed lease lapses and the device goes silent. */
export function covExpiresAt(lease: CovLease): number {
  return lease.subscribedAtSimSec + lease.lifetimeSeconds;
}

export function isCovRenewalDue(lease: CovLease, nowSimSec: number): boolean {
  if (lease.lifetimeSeconds <= 0) return false;
  return nowSimSec >= covRenewalDueAt(lease);
}

export function isCovLeaseExpired(lease: CovLease, nowSimSec: number): boolean {
  if (lease.lifetimeSeconds <= 0) return false;
  return nowSimSec >= covExpiresAt(lease);
}

/** Deterministic per-subscription scan delay in [minS, maxS).
 *
 *  Hash-based rather than Math.random so a given (subscription, sequence)
 *  pair always produces the same delay — replays and tests stay stable
 *  while different subscriptions still de-correlate (no thundering herd
 *  of notifications on the same tick). FNV-1a over `key#seq`. */
export function covScanDelay(
  key: string,
  seq: number,
  minS: number = COV_SCAN_MIN_S,
  maxS: number = COV_SCAN_MAX_S,
): number {
  let h = 0x811c9dc5;
  const s = `${key}#${seq}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 → uint32; scale into [0, 1).
  const unit = (h >>> 0) / 0x100000000;
  return minS + unit * (maxS - minS);
}
