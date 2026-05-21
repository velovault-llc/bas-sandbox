// Runtime check executor for scenario validation.
//
// After the user has built the topology and written a program, this runs
// each scenario.runtimeChecks against the program: drives the inputs the
// check specifies, executes the compiled program once, and validates the
// outputs against the check's `expects` array. Returns pass/fail + the
// actual values so the panel can show "expected actuator 0.7-1.0, got
// 0.42" when a check misses.

import { runProgram, makeEnv, type RuntimeCheck, type ScenarioDefinition, type StProgram } from '@bas/core';

export interface CheckExpectationResult {
  readonly output: string;
  readonly actual: number;
  readonly passed: boolean;
  readonly reason?: string;
}

export interface CheckResult {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  readonly expectations: readonly CheckExpectationResult[];
  /** Outputs the program wrote during this check, for debugging. */
  readonly allOutputs: Readonly<Record<string, number>>;
  /** Compile / runtime error if any. */
  readonly error?: string;
}

export interface RuntimeChecksResult {
  readonly allPassed: boolean;
  readonly perCheck: readonly CheckResult[];
  /** Surface-level reason when no checks could run (program missing, etc). */
  readonly notice?: string;
}

/**
 * Run every check in the scenario against the user's compiled program.
 *
 * Each check gets a fresh env. The program's persistent state (VAR block,
 * PID integrators) is NOT shared across checks — checks are independent
 * snapshots. That matches the "given these inputs, what should the
 * controller command?" question users actually want to answer.
 */
export function runRuntimeChecks(
  scenario: ScenarioDefinition,
  compiled: StProgram | null,
): RuntimeChecksResult {
  if (!compiled) {
    return {
      allPassed: false,
      perCheck: scenario.runtimeChecks.map((rc) => ({
        id: rc.id,
        description: rc.description,
        passed: false,
        expectations: [],
        allOutputs: {},
        error: 'No program installed on the controller yet.',
      })),
      notice: 'Install a program on the scenario controller (Terminal → program, or Diagram), then click "Run checks".',
    };
  }

  const perCheck: CheckResult[] = scenario.runtimeChecks.map((rc) => runOneCheck(rc, compiled));
  return {
    allPassed: perCheck.every((c) => c.passed),
    perCheck,
  };
}

function runOneCheck(rc: RuntimeCheck, compiled: StProgram): CheckResult {
  const env = makeEnv({
    inputs: { ...rc.inputs },
    outputs: {},
    state: {},
    dt: 1,
  });
  try {
    runProgram(compiled, env);
  } catch (err) {
    return {
      id: rc.id,
      description: rc.description,
      passed: false,
      expectations: [],
      allOutputs: { ...env.outputs },
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const expectations: CheckExpectationResult[] = rc.expects.map((exp) => {
    const actual = env.outputs[exp.output];
    if (actual === undefined) {
      return {
        output: exp.output,
        actual: NaN,
        passed: false,
        reason: `Program never assigned a value to "${exp.output}".`,
      };
    }
    if (exp.approx !== undefined) {
      const tol = exp.tolerance ?? 0.01;
      const ok = Math.abs(actual - exp.approx) <= tol;
      return {
        output: exp.output,
        actual,
        passed: ok,
        reason: ok ? undefined : `Expected ≈${exp.approx} (±${tol}), got ${actual.toFixed(3)}.`,
      };
    }
    if (exp.min !== undefined || exp.max !== undefined) {
      const okMin = exp.min === undefined || actual >= exp.min;
      const okMax = exp.max === undefined || actual <= exp.max;
      const ok = okMin && okMax;
      const range =
        exp.min !== undefined && exp.max !== undefined
          ? `${exp.min}–${exp.max}`
          : exp.min !== undefined
            ? `≥${exp.min}`
            : `≤${exp.max}`;
      return {
        output: exp.output,
        actual,
        passed: ok,
        reason: ok ? undefined : `Expected ${range}, got ${actual.toFixed(3)}.`,
      };
    }
    return { output: exp.output, actual, passed: true };
  });

  return {
    id: rc.id,
    description: rc.description,
    passed: expectations.every((e) => e.passed),
    expectations,
    allOutputs: { ...env.outputs },
  };
}
