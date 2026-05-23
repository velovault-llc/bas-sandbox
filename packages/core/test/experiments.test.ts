import { describe, it, expect } from 'vitest';
import {
  EXPERIMENT_CATALOG,
  runExperiment,
  runCatalog,
  findExperiment,
  experimentsByTag,
  formatCatalogMarkdown,
} from '../src/experiments/index.js';
import type { ExperimentSpec } from '../src/experiments/index.js';

describe('experiment catalog', () => {
  it('every seed experiment passes its own expectations', () => {
    const run = runCatalog(EXPERIMENT_CATALOG);
    const failures = run.results.filter((r) => !r.passed);
    if (failures.length > 0) {
      // Print useful diagnostic when this regresses.
      const detail = failures.map((f) => ({
        id: f.id,
        title: f.title,
        failed: f.expectations.filter((e) => !e.satisfied),
      }));
      // eslint-disable-next-line no-console
      console.error('Catalog regression:', JSON.stringify(detail, null, 2));
    }
    expect(failures).toEqual([]);
    expect(run.summary.total).toBe(EXPERIMENT_CATALOG.length);
    expect(run.summary.passed).toBe(EXPERIMENT_CATALOG.length);
    expect(run.summary.failed).toBe(0);
  });

  it('findExperiment returns the spec by id', () => {
    const found = findExperiment('conformance.whois-cadence-healthy');
    expect(found).toBeDefined();
    expect(found!.title).toMatch(/Who-Is cadence/);
  });

  it('experimentsByTag filters', () => {
    const positives = experimentsByTag('positive');
    expect(positives.length).toBeGreaterThan(0);
    for (const e of positives) {
      expect(e.tags).toContain('positive');
    }
  });

  it('formatCatalogMarkdown produces a sane report', () => {
    const run = runCatalog(EXPERIMENT_CATALOG);
    const md = formatCatalogMarkdown(run);
    expect(md).toContain('# bas-sandbox experiment run');
    expect(md).toMatch(new RegExp(`Total:\\*\\*\\s+${EXPERIMENT_CATALOG.length}`));
    expect(md).toMatch(/\[PASS\].*conformance\.whois-cadence-healthy/);
  });
});

describe('runExperiment', () => {
  it('FAILS when an absent-expected finding actually fires', () => {
    // Deliberately wrong expectation: claim duplicate-mac will NOT
    // fire on a trunk that has duplicate MACs.
    const wrong: ExperimentSpec = {
      id: 'self-test.contradictory',
      title: 'Contradictory expectation',
      hypothesis: 'On purpose: expects absence but the rule fires.',
      scenario: {
        scope: 'mstp',
        inputs: {
          trunks: [
            {
              trunkId: 't1',
              devices: [
                { nodeId: 'a', mac: 1, label: 'A' },
                { nodeId: 'b', mac: 1, label: 'B' },
              ],
            },
          ],
        },
      },
      expects: [{ id: 'mstp.duplicate-mac', present: false }],
    };
    const r = runExperiment(wrong);
    expect(r.passed).toBe(false);
    expect(r.expectations[0].satisfied).toBe(false);
    expect(r.expectations[0].actualCount).toBeGreaterThan(0);
  });

  it('FAILS when a present-expected finding does not fire', () => {
    // Expect duplicate-mac on a clean trunk (no duplicates).
    const wrong: ExperimentSpec = {
      id: 'self-test.missing-finding',
      title: 'Expect-present that never fires',
      hypothesis: 'On purpose: clean trunk shouldn\'t fire duplicate-mac.',
      scenario: {
        scope: 'mstp',
        inputs: {
          trunks: [
            {
              trunkId: 't2',
              devices: [
                { nodeId: 'a', mac: 0, label: 'A' },
                { nodeId: 'b', mac: 1, label: 'B' },
              ],
            },
          ],
        },
      },
      expects: [{ id: 'mstp.duplicate-mac', present: true }],
    };
    const r = runExperiment(wrong);
    expect(r.passed).toBe(false);
    expect(r.expectations[0].satisfied).toBe(false);
    expect(r.expectations[0].actualCount).toBe(0);
  });

  it('checks severity when provided in expectation', () => {
    const ipv4Spec: ExperimentSpec = {
      id: 'self-test.severity',
      title: 'Severity match',
      hypothesis: 'duplicate-ip is an error, not a warning.',
      scenario: {
        scope: 'ipv4',
        inputs: {
          devices: [
            { nodeId: 'a', label: 'A', ipAddress: '10.0.1.10', subnetMask: '255.255.255.0' },
            { nodeId: 'b', label: 'B', ipAddress: '10.0.1.10', subnetMask: '255.255.255.0' },
          ],
        },
      },
      expects: [
        // Intentionally wrong severity to confirm the check works.
        { id: 'ipv4.duplicate-ip', present: true, severity: 'warning' },
      ],
    };
    const r = runExperiment(ipv4Spec);
    expect(r.passed).toBe(false);
    expect(r.expectations[0].note).toMatch(/severity/);
  });

  it('completes a single experiment in well under 50ms', () => {
    // Performance sanity — the harness should be cheap so the agent
    // can iterate fast.
    const spec = EXPERIMENT_CATALOG[0];
    const r = runExperiment(spec);
    expect(r.durationMs).toBeLessThan(50);
  });
});
