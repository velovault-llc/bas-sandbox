// Experiment runner — executes ExperimentSpec[] against the
// sandbox's validators and matches actual findings against the
// catalog's expectations.
//
// All work is synchronous + pure. The runner can execute the
// whole catalog (currently ~6 experiments) in single-digit ms.

import { checkBacnetConformance } from '../bacnet/conformance.js';
import { validateBacnetIpNetwork, validateIpZones } from '../bacnet/ipv4.js';
import { validateMstpTrunks } from '../bacnet/validate.js';
import type {
  ExperimentSpec,
  ExperimentResult,
  CatalogRunResult,
  ExpectedFinding,
} from './types.js';

/** Run a single experiment. Returns a structured result with the
 *  raw findings + per-expectation pass/fail breakdown. */
export function runExperiment(spec: ExperimentSpec): ExperimentResult {
  const t0 = perfNow();

  // Dispatch to the right validator(s) based on scope.
  type Finding = {
    id: string;
    severity: 'info' | 'warning' | 'error';
    title: string;
    description?: string;
    citation?: string;
  };
  let findings: Finding[] = [];

  if (spec.scenario.scope === 'bacnet-conformance') {
    findings = checkBacnetConformance(spec.scenario.inputs.packets).map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      citation: f.citation,
    }));
  } else if (spec.scenario.scope === 'ipv4') {
    const { devices, edges = [], routers = [], zones = [] } = spec.scenario.inputs;
    const net = validateBacnetIpNetwork(devices, edges, routers);
    // validateIpZones expects PlacedBacnetIpDevice (includes x/y for
    // zone-containment math). We re-use the BacnetIpDevice list as
    // unplaced (no x/y) when zones aren't supplied; when zones ARE
    // supplied, callers must provide x/y. Defensive cast below.
    const zonesFindings = zones.length > 0
      ? validateIpZones(
          devices.map((d) => ({
            ...d,
            x: (d as { x?: number }).x ?? 0,
            y: (d as { y?: number }).y ?? 0,
          })),
          zones,
        )
      : [];
    findings = [...net, ...zonesFindings].map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      citation: undefined,
    }));
  } else if (spec.scenario.scope === 'mstp') {
    findings = validateMstpTrunks(spec.scenario.inputs.trunks).map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      citation: undefined,
    }));
  }

  // Match each expectation against the actual findings.
  const expectations = spec.expects.map((exp) => evaluateExpectation(exp, findings));
  const passed = expectations.every((e) => e.satisfied);

  return {
    id: spec.id,
    title: spec.title,
    passed,
    scope: spec.scenario.scope,
    findings,
    expectations,
    ranAt: new Date().toISOString(),
    durationMs: Math.max(0, perfNow() - t0),
  };
}

/** Run a whole catalog, return aggregated result + per-experiment
 *  breakdown. */
export function runCatalog(specs: readonly ExperimentSpec[]): CatalogRunResult {
  const t0 = perfNow();
  const results = specs.map(runExperiment);
  const passed = results.filter((r) => r.passed).length;
  return {
    ranAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      durationMs: Math.max(0, perfNow() - t0),
    },
  };
}

/** Format a CatalogRunResult as a Markdown report. Suitable for
 *  pasting into a PR description or stashing in a docs file. */
export function formatCatalogMarkdown(run: CatalogRunResult): string {
  const lines: string[] = [];
  lines.push(`# bas-sandbox experiment run`);
  lines.push('');
  lines.push(`- **Ran at:** ${run.ranAt}`);
  lines.push(`- **Total:** ${run.summary.total}`);
  lines.push(`- **Passed:** ${run.summary.passed}`);
  lines.push(`- **Failed:** ${run.summary.failed}`);
  lines.push(`- **Duration:** ${run.summary.durationMs.toFixed(1)} ms`);
  lines.push('');
  for (const r of run.results) {
    const flag = r.passed ? 'PASS' : 'FAIL';
    lines.push(`## [${flag}] ${r.id} — ${r.title}`);
    lines.push('');
    lines.push(`- Scope: \`${r.scope}\``);
    lines.push(`- Findings emitted: ${r.findings.length}`);
    if (r.findings.length > 0) {
      lines.push('');
      lines.push('| Severity | Id | Title |');
      lines.push('|---|---|---|');
      for (const f of r.findings) {
        lines.push(`| ${f.severity} | \`${f.id}\` | ${f.title} |`);
      }
    }
    if (r.expectations.length > 0) {
      lines.push('');
      lines.push('Expectations:');
      for (const e of r.expectations) {
        const mark = e.satisfied ? '[x]' : '[ ]';
        const want = e.expected.present ? 'present' : 'absent';
        lines.push(
          `- ${mark} \`${e.expected.id}\` ${want}` +
            (e.expected.severity ? ` (severity=${e.expected.severity})` : '') +
            ` — actualCount=${e.actualCount}` +
            (e.note ? ` · ${e.note}` : ''),
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────

function evaluateExpectation(
  expected: ExpectedFinding,
  findings: ReadonlyArray<{ id: string; severity: 'info' | 'warning' | 'error' }>,
): {
  expected: ExpectedFinding;
  satisfied: boolean;
  actualCount: number;
  note?: string;
} {
  const matching = findings.filter((f) => f.id === expected.id);
  const count = matching.length;
  if (expected.present) {
    const min = expected.minCount ?? 1;
    if (count < min) {
      return {
        expected,
        satisfied: false,
        actualCount: count,
        note: `expected at least ${min}, got ${count}`,
      };
    }
    if (expected.severity) {
      const allMatchSev = matching.every((f) => f.severity === expected.severity);
      if (!allMatchSev) {
        return {
          expected,
          satisfied: false,
          actualCount: count,
          note: `severity mismatch — got [${matching.map((f) => f.severity).join(', ')}]`,
        };
      }
    }
    return { expected, satisfied: true, actualCount: count };
  } else {
    // Expect absent.
    if (count > 0) {
      return {
        expected,
        satisfied: false,
        actualCount: count,
        note: `expected absent but fired ${count} time(s)`,
      };
    }
    return { expected, satisfied: true, actualCount: 0 };
  }
}

function perfNow(): number {
  // Node + browser both expose performance.now(). Fall back to
  // Date.now() defensively (test env shims).
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
