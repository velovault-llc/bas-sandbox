// Experiment harness — types.
//
// An "experiment" is a declarative, runnable test of the sandbox's
// validation surface. It bundles a synthetic packet stream (or a
// synthetic topology) with a list of EXPECTED findings, then the
// runner asserts what actually came out matches.
//
// Two consumers:
//   1. The autonomous-play loop — the agent writes new experiments
//      to probe behavior, runs them, reads the structured result.
//   2. Unit tests + CI — the catalog itself is a regression suite.
//
// Design constraint: experiments must be pure data. No DOM, no I/O.
// That's what lets a Node CLI run the whole catalog in <100ms and
// emit a machine-readable report.

import type { ConformancePacket, ConformanceFindingId } from '../bacnet/conformance.js';
import type {
  BacnetIpDevice,
  BacnetIpEdge,
  BacnetIpRouter,
  SubnetZone,
  Ipv4FindingId,
} from '../bacnet/ipv4.js';
// MstpTrunkSnapshot + MstpFindingId both live in validate.ts.
import type { MstpTrunkSnapshot, MstpFindingId } from '../bacnet/validate.js';

/** Which validator family this experiment targets. Drives which
 *  finding-id union the expectations validate against. */
export type ExperimentScope = 'bacnet-conformance' | 'ipv4' | 'mstp';

/** A single finding the experiment expects to see (or NOT see).
 *  `present: true` means "this id must appear in the result";
 *  `present: false` means "this id must NOT appear" — useful for
 *  regression-style experiments ("after fix X, no longer fires Y"). */
export interface ExpectedFinding {
  readonly id: string;
  readonly present: boolean;
  /** Optional severity check. */
  readonly severity?: 'info' | 'warning' | 'error';
  /** Optional minimum count when `present: true` (default = 1). */
  readonly minCount?: number;
}

/** Inputs for the bacnet-conformance scope: a sequence of packets
 *  on the wire. The runner passes these straight to
 *  checkBacnetConformance and matches expectations against the
 *  output. */
export interface BacnetConformanceInputs {
  readonly packets: readonly ConformancePacket[];
}

/** Inputs for the ipv4 scope: a topology of BACnet/IP devices,
 *  optional edges/routers/zones. Runner calls
 *  validateBacnetIpNetwork + validateIpZones. */
export interface Ipv4Inputs {
  readonly devices: readonly BacnetIpDevice[];
  readonly edges?: readonly BacnetIpEdge[];
  readonly routers?: readonly BacnetIpRouter[];
  readonly zones?: readonly SubnetZone[];
}

/** Inputs for the mstp scope: one or more trunk snapshots. */
export interface MstpInputs {
  readonly trunks: readonly MstpTrunkSnapshot[];
}

export type ExperimentInputs =
  | { scope: 'bacnet-conformance'; inputs: BacnetConformanceInputs }
  | { scope: 'ipv4'; inputs: Ipv4Inputs }
  | { scope: 'mstp'; inputs: MstpInputs };

export interface ExperimentSpec {
  /** Stable id. Used in the report, deep-linkable. */
  readonly id: string;
  /** One-sentence human title. */
  readonly title: string;
  /** What invariant this is testing, in BAS-tech language. */
  readonly hypothesis: string;
  /** Optional ASHRAE / vendor citation backing the rule. */
  readonly citation?: string;
  /** What the experiment exercises. */
  readonly scenario: ExperimentInputs;
  /** Finding-level expectations. The runner pass/fails based on
   *  whether every expectation is satisfied. */
  readonly expects: readonly ExpectedFinding[];
  /** Free-form tags for filtering. */
  readonly tags?: readonly string[];
}

export interface ExperimentResult {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly scope: ExperimentScope;
  /** All findings the validators emitted, regardless of expectations. */
  readonly findings: ReadonlyArray<{
    readonly id: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly title: string;
    readonly description?: string;
    readonly citation?: string;
  }>;
  /** Per-expectation breakdown — which matched, which didn't. */
  readonly expectations: ReadonlyArray<{
    readonly expected: ExpectedFinding;
    readonly satisfied: boolean;
    readonly actualCount: number;
    readonly note?: string;
  }>;
  /** ISO timestamp for reporting. */
  readonly ranAt: string;
  /** Duration in milliseconds — for spotting accidentally-expensive
   *  experiments. Currently rough since experiments are pure-fn. */
  readonly durationMs: number;
}

export interface CatalogRunResult {
  readonly ranAt: string;
  readonly results: readonly ExperimentResult[];
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly durationMs: number;
  };
}

/** Finding-id unions exposed for type-safety in expectations.
 *  Keeping these as plain string in ExpectedFinding so external
 *  callers can match against arbitrary ids; these aliases are for
 *  authoring catalog entries with autocomplete. */
export type AnyKnownFindingId =
  | ConformanceFindingId
  | Ipv4FindingId
  | MstpFindingId;
