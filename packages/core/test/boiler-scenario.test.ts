import { describe, expect, it } from 'vitest';
import {
  compileFbd,
  compile,
  makeEnv,
  runProgram,
  findScenario,
} from '../src/index.js';

describe('Boiler + HW loop scenario', () => {
  const scenario = findScenario('boiler-hw-loop');

  it('is in the library', () => {
    expect(scenario).toBeDefined();
  });

  it('starter graph compiles to ST', () => {
    const fbd = compileFbd(scenario!.program.starterGraph!);
    expect(fbd.ok, fbd.error).toBe(true);
    const st = compile(fbd.source!);
    expect(st.ok, st.error).toBe(true);
  });

  describe('runtime checks pass against the starter graph', () => {
    for (const rc of scenario?.runtimeChecks ?? []) {
      it(rc.id, () => {
        const fbd = compileFbd(scenario!.program.starterGraph!);
        const st = compile(fbd.source!);
        const env = makeEnv({ inputs: { ...rc.inputs }, dt: 1 });
        runProgram(st.program!, env);
        for (const exp of rc.expects) {
          const actual = env.outputs[exp.output];
          expect(actual, `${exp.output} should be defined for ${rc.id}`).toBeDefined();
          if (exp.approx !== undefined) {
            expect(Math.abs(actual - exp.approx)).toBeLessThanOrEqual(exp.tolerance ?? 0.01);
          }
          if (exp.min !== undefined) expect(actual).toBeGreaterThanOrEqual(exp.min);
          if (exp.max !== undefined) expect(actual).toBeLessThanOrEqual(exp.max);
        }
      });
    }
  });
});
