// Discrete-event MS/TP bus model — the engine behind trunk congestion
// and COV saturation.
//
// The existing mstp.ts models the token as a cadence (each device gets an
// equal time slice). That's fine for "watch the token hop" but it can't
// show CONGESTION: when offered load (polls + COV notifications + their
// ACKs) exceeds what the RS-485 bus can carry, real trunks back up —
// latency climbs, queues grow, and frames eventually drop. You can't
// capture that without modelling the bus as a finite-bandwidth resource
// that frames compete for.
//
// This module does that at frame granularity:
//   - The bus carries one frame at a time; each frame occupies the wire
//     for its transmission time (octets × bit-time), derived from baud.
//   - The token rotates among masters in MAC order. The token-holder may
//     send up to Max_Info_Frames data frames before passing the token.
//   - A confirmed request also ties up the bus for the reply + turnarounds.
//   - Each master has a bounded transmit queue; frames offered to a full
//     queue are dropped (the real-world failure mode under COV storms).
//
// `stepBus` advances the bus by dt sim-seconds, draining queues as the
// token rotates, and returns the frames that completed plus the window's
// congestion metrics (utilisation, backlog, drops, rotations).
//
// Faithful enough to predict bus saturation; not a bit-exact RS-485 PHY.

// ── Frame sizing ─────────────────────────────────────────────────────

/** MS/TP header is 8 octets: 2 preamble + frame-type + dest + src +
 *  length-hi + length-lo + header-CRC. Data frames add a 2-octet data CRC
 *  after the payload. Token / Poll-For-Master frames carry no data. */
export const MSTP_HEADER_OCTETS = 8;
export const MSTP_DATA_CRC_OCTETS = 2;

/** Typical application-data sizes (octets) for the services we model.
 *  Ballpark — enough to make relative bus load realistic. */
export const FRAME_DATA_OCTETS = {
  readPropertyRequest: 12,
  readPropertyAck: 20,
  covNotification: 28,
  writePropertyRequest: 22,
  iam: 13,
  whois: 2,
} as const;

export type FrameKind = 'token' | 'pfm' | 'request' | 'reply' | 'unconfirmed';

export interface BusFrame {
  readonly id: number;
  readonly srcMac: number;
  /** 255 = broadcast. */
  readonly dstMac: number;
  readonly kind: FrameKind;
  /** Application payload octets (0 for token / PFM). */
  readonly dataOctets: number;
  /** True if this is a confirmed request whose reply also occupies the
   *  bus (request frame + turnaround + reply frame + turnaround). */
  readonly confirmed: boolean;
  /** Reply payload octets, used when `confirmed`. */
  readonly replyOctets: number;
  /** Sim-seconds when the frame was offered to the bus. */
  readonly enqueuedSec: number;
  /** Service label, for reporting. */
  readonly service?: string;
}

/** A completed frame plus the latency it experienced (queue wait + the
 *  transmission, including reply for confirmed services). */
export interface CompletedFrame {
  readonly frame: BusFrame;
  readonly completedSec: number;
  readonly latencySec: number;
}

// ── Bus configuration + state ────────────────────────────────────────

export interface MstpBusConfig {
  readonly baud: number;
  /** Max data frames a master may send per token (Nmax_info_frames).
   *  Default 1 per the standard; many vendors raise it. */
  readonly maxInfoFrames: number;
  /** Per-master transmit-queue cap. Frames offered beyond this are
   *  dropped — the COV-storm failure mode. */
  readonly maxQueue: number;
}

export const defaultMstpBusConfig = (baud = 38400): MstpBusConfig => ({
  baud,
  maxInfoFrames: 1,
  maxQueue: 64,
});

interface BusMaster {
  readonly mac: number;
  queue: BusFrame[];
}

export interface MstpBusState {
  readonly config: MstpBusConfig;
  /** Masters in MAC order — the token ring. */
  readonly masters: BusMaster[];
  tokenIndex: number;
  rotations: number;
  /** Bus clock (sim-seconds). */
  simSec: number;
  /** Cumulative octet-time spent carrying DATA frames (excludes token
   *  overhead) — for lifetime utilisation. */
  dataBusySec: number;
  /** Cumulative frames dropped at enqueue due to a full queue. */
  droppedTotal: number;
}

/** Per-step congestion readout. */
export interface BusStepResult {
  readonly completed: CompletedFrame[];
  readonly framesSent: number;
  readonly rotations: number;
  /** Fraction of the window the bus spent carrying DATA frames (0..1).
   *  Approaches 1 as the trunk saturates. */
  readonly utilisation: number;
  /** Total frames still queued across all masters after the step. */
  readonly backlog: number;
  /** Deepest single master queue after the step. */
  readonly maxQueueDepth: number;
  /** Frames dropped (full queue) during enqueues since the last step
   *  read — caller resets via the returned state if desired. */
  readonly droppedTotal: number;
}

// ── Timing primitives ────────────────────────────────────────────────

/** Seconds to transmit one octet: 10 bits (1 start + 8 data + 1 stop). */
export function octetTimeSec(baud: number): number {
  return 10 / Math.max(1, baud);
}

/** Turnaround / inter-frame gap (~40 bit-times is typical for MS/TP). */
function turnaroundSec(baud: number): number {
  return 40 / Math.max(1, baud);
}

/** Wire time for a frame with `dataOctets` of payload (0 = header only). */
export function frameTimeSec(baud: number, dataOctets: number): number {
  const octets = MSTP_HEADER_OCTETS + (dataOctets > 0 ? dataOctets + MSTP_DATA_CRC_OCTETS : 0);
  return octets * octetTimeSec(baud);
}

/** Total bus time a frame consumes, including the reply + turnarounds for
 *  a confirmed service. */
function frameCostSec(cfg: MstpBusConfig, f: BusFrame): number {
  const ta = turnaroundSec(cfg.baud);
  let cost = frameTimeSec(cfg.baud, f.dataOctets) + ta;
  if (f.confirmed) {
    cost += frameTimeSec(cfg.baud, f.replyOctets) + ta;
  }
  return cost;
}

// ── Construction ─────────────────────────────────────────────────────

export function initMstpBus(macs: readonly number[], config: MstpBusConfig = defaultMstpBusConfig()): MstpBusState {
  return {
    config,
    masters: macs.map((mac) => ({ mac, queue: [] })),
    tokenIndex: 0,
    rotations: 0,
    simSec: 0,
    dataBusySec: 0,
    droppedTotal: 0,
  };
}

let _nextFrameId = 1;

/** Build a frame ready to enqueue. */
export function makeFrame(opts: {
  srcMac: number;
  dstMac: number;
  kind: FrameKind;
  dataOctets: number;
  confirmed?: boolean;
  replyOctets?: number;
  enqueuedSec: number;
  service?: string;
}): BusFrame {
  return {
    id: _nextFrameId++,
    srcMac: opts.srcMac,
    dstMac: opts.dstMac,
    kind: opts.kind,
    dataOctets: opts.dataOctets,
    confirmed: opts.confirmed ?? false,
    replyOctets: opts.replyOctets ?? 0,
    enqueuedSec: opts.enqueuedSec,
    service: opts.service,
  };
}

/** Offer a frame to a master's transmit queue. Returns false (and counts
 *  a drop) if that master's queue is full — the congestion-loss path. */
export function enqueueFrame(state: MstpBusState, mac: number, frame: BusFrame): boolean {
  const m = state.masters.find((x) => x.mac === mac);
  if (!m) return false;
  if (m.queue.length >= state.config.maxQueue) {
    state.droppedTotal += 1;
    return false;
  }
  m.queue.push(frame);
  return true;
}

function totalBacklog(masters: readonly BusMaster[]): number {
  let n = 0;
  for (const m of masters) n += m.queue.length;
  return n;
}

// ── The step ─────────────────────────────────────────────────────────

/** Advance the bus by `dtSeconds`, rotating the token and draining
 *  queues. Mutates and returns `state`, plus a window readout. */
export function stepBus(state: MstpBusState, dtSeconds: number): BusStepResult {
  const cfg = state.config;
  const completed: CompletedFrame[] = [];
  const startSec = state.simSec;

  let elapsed = 0; // bus time consumed this window
  let dataSec = 0; // of which, time carrying data frames
  let framesSent = 0;
  let rotations = 0;

  const ta = turnaroundSec(cfg.baud);
  const tokenSec = frameTimeSec(cfg.baud, 0) + ta; // token-pass frame

  if (state.masters.length === 0 || dtSeconds <= 0) {
    state.simSec += Math.max(0, dtSeconds);
    return {
      completed, framesSent: 0, rotations: 0, utilisation: 0,
      backlog: 0, maxQueueDepth: 0, droppedTotal: state.droppedTotal,
    };
  }

  // Safety cap so a degenerate config can't spin forever.
  let guard = 2_000_000;
  while (elapsed < dtSeconds && guard-- > 0) {
    // Idle bus: nothing queued anywhere → stop simulating token spins and
    // let the clock fast-forward. Congestion metrics only care about load.
    if (totalBacklog(state.masters) === 0) break;

    const holder = state.masters[state.tokenIndex];
    let servedHere = 0;
    let budgetHit = false;

    while (holder.queue.length > 0 && servedHere < cfg.maxInfoFrames) {
      const f = holder.queue[0];
      const cost = frameCostSec(cfg, f);
      if (elapsed + cost > dtSeconds) {
        budgetHit = true; // not enough room this window; frame waits
        break;
      }
      elapsed += cost;
      dataSec += cost;
      holder.queue.shift();
      const completedSec = startSec + elapsed;
      completed.push({ frame: f, completedSec, latencySec: completedSec - f.enqueuedSec });
      framesSent += 1;
      servedHere += 1;
    }

    if (budgetHit) break;

    // Pass the token (costs a token frame on the wire).
    if (elapsed + tokenSec > dtSeconds) break;
    elapsed += tokenSec;
    state.tokenIndex = (state.tokenIndex + 1) % state.masters.length;
    if (state.tokenIndex === 0) {
      state.rotations += 1;
      rotations += 1;
    }
  }

  state.simSec = startSec + dtSeconds;
  state.dataBusySec += dataSec;

  let maxQueueDepth = 0;
  for (const m of state.masters) maxQueueDepth = Math.max(maxQueueDepth, m.queue.length);

  return {
    completed,
    framesSent,
    rotations,
    utilisation: Math.min(1, dataSec / dtSeconds),
    backlog: totalBacklog(state.masters),
    maxQueueDepth,
    droppedTotal: state.droppedTotal,
  };
}
