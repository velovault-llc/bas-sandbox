// Corpus validation summary — the headline number behind any
// "real-corpus validated" claim the sandbox makes in marketing,
// product copy, or capability statements.
//
// What this is: a baked-in snapshot of the validation results
// produced by `tools/bacnet-harness/harness/diff_harness.py` with
// the RawPassthroughAdapter, against Steve Karg's public corpus
// at kargs.net/captures.
//
// What this is NOT: a runtime validation hook. The validation
// runs in Python (tshark + bacpypes3) and emits the JSON reports
// under tools/bacnet-harness/reports/. This module re-publishes
// those numbers as a TypeScript constant the UI can render
// without shelling to a Python interpreter at runtime.
//
// How to refresh: re-run the harness in Python:
//   cd tools/bacnet-harness
//   python -m harness.diff_harness baselines/*.json \
//       --adapter harness.bas_adapter:RawPassthroughAdapter
// Then bump LAST_VALIDATED_AT and the per-capture numbers below.
// Long-term we'd auto-generate this from the JSON reports, but
// the corpus is small + stable enough that a hand-update once
// per session is fine.

/** What kind of corpus run produced these numbers. */
export type CorpusAdapter =
  | 'raw-passthrough'  // transport-layer roundtrip — BVLL/NPDU only
  | 'codec-roundtrip'; // bacpypes3 service-body codec faithfulness

export interface CorpusCaptureResult {
  /** The .cap filename in the kargs.net corpus. */
  readonly capture: string;
  /** Number of paired request/response transactions tested. */
  readonly total: number;
  /** Number that passed byte-exact roundtrip. */
  readonly passed: number;
  /** True for captures whose responses are MALFORMED by design
   *  (e.g. bacapp-malform.cap). Rejecting them is correct
   *  behavior; counting them toward the pass-rate would
   *  misrepresent the result. */
  readonly expectedAllMalformed?: boolean;
  /** Optional one-line context for the UI. */
  readonly note?: string;
}

export interface CorpusValidationSummary {
  /** ISO date of the last hand-refresh of these numbers. */
  readonly lastValidatedAt: string;
  /** Which harness adapter produced the numbers. */
  readonly adapter: CorpusAdapter;
  /** Per-capture detail. */
  readonly captures: readonly CorpusCaptureResult[];
  /** Aggregated totals across well-formed captures. */
  readonly totals: {
    /** Sum of `total` across non-malformed captures. */
    readonly total: number;
    /** Sum of `passed`. */
    readonly passed: number;
    /** Percent passing, computed from totals. */
    readonly passRate: number;
  };
  /** Where the captures came from — credit + provenance for the
   *  marketing-truth claim. */
  readonly source: {
    readonly url: string;
    readonly maintainer: string;
    readonly license: string;
  };
}

export const CORPUS_VALIDATION_SUMMARY: CorpusValidationSummary = {
  lastValidatedAt: '2026-05-25',
  adapter: 'raw-passthrough',
  source: {
    url: 'https://kargs.net/captures/',
    maintainer: 'Steve Karg (author of bacnet-stack)',
    license: 'Public BACnet samples',
  },
  captures: [
    { capture: 'atomic-read-file.cap', total: 64, passed: 64 },
    { capture: 'atomic_write_file_bad_ack.cap', total: 3, passed: 3 },
    { capture: 'atomic-write-file.cap', total: 1557, passed: 1557 },
    { capture: 'atomic-write-file-seg.cap', total: 278, passed: 278 },
    { capture: 'BACnetARRAY-elements.cap', total: 4, passed: 4 },
    { capture: 'BACnetARRAY-element-0.cap', total: 3, passed: 3 },
    { capture: 'alerton-plugfest-2.cap', total: 17614, passed: 17614 },
    {
      capture: 'bacapp-malform.cap',
      total: 832,
      passed: 0,
      expectedAllMalformed: true,
      note: 'every response is BVLL-malformed by design; rejection is correct stack behavior',
    },
  ],
  totals: {
    total: 19523,
    passed: 19523,
    passRate: 100,
  },
};
