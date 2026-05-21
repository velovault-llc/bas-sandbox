import { describe, expect, it } from 'vitest';
import {
  SCENARIO_LIBRARY,
  compileFbd,
  compile,
  makeEnv,
  runProgram,
  findScenario,
} from '../src/index.js';

describe('AHU economizer scenario', () => {
  const scenario = findScenario('ahu-economizer');

  it('is in the SCENARIO_LIBRARY', () => {
    expect(scenario).toBeDefined();
    expect(SCENARIO_LIBRARY).toContain(scenario);
  });

  it('starter graph compiles to ST', () => {
    const graph = scenario?.program.starterGraph;
    expect(graph).toBeDefined();
    const fbd = compileFbd(graph!);
    expect(fbd.ok, fbd.error).toBe(true);
    const st = compile(fbd.source!);
    expect(st.ok, st.error).toBe(true);
  });

  describe('starter graph passes every runtime check', () => {
    for (const rc of scenario?.runtimeChecks ?? []) {
      it(rc.id, () => {
        const graph = scenario!.program.starterGraph!;
        const fbd = compileFbd(graph);
        expect(fbd.ok).toBe(true);
        const st = compile(fbd.source!);
        expect(st.ok).toBe(true);
        const env = makeEnv({ inputs: { ...rc.inputs }, dt: 1 });
        runProgram(st.program!, env);

        for (const exp of rc.expects) {
          const actual = env.outputs[exp.output];
          expect(actual, `${exp.output} should be defined`).toBeDefined();
          if (exp.approx !== undefined) {
            const tol = exp.tolerance ?? 0.01;
            expect(Math.abs(actual - exp.approx)).toBeLessThanOrEqual(tol);
          }
          if (exp.min !== undefined) {
            expect(actual).toBeGreaterThanOrEqual(exp.min);
          }
          if (exp.max !== undefined) {
            expect(actual).toBeLessThanOrEqual(exp.max);
          }
        }
      });
    }
  });
});
