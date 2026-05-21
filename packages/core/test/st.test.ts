import { describe, expect, it } from 'vitest';
import { compile, makeEnv, runProgram, tokenize, parse } from '../src/st/index.js';

function execute(source: string, inputs: Record<string, number> = {}, dt = 1) {
  const res = compile(source);
  if (!res.ok || !res.program) throw new Error(res.error ?? 'compile failed');
  const env = makeEnv({ inputs, dt });
  runProgram(res.program, env);
  return env;
}

describe('lexer', () => {
  it('tokenizes simple assignment', () => {
    const toks = tokenize('x := 1.5;');
    expect(toks.map((t) => t.kind)).toEqual([
      'identifier',
      'op_assign',
      'number',
      'semicolon',
      'eof',
    ]);
  });

  it('recognizes keywords case-insensitively', () => {
    const toks = tokenize('IF True THEN');
    expect(toks[0].kind).toBe('kw_if');
    expect(toks[1].kind).toBe('boolean');
    expect(toks[2].kind).toBe('kw_then');
  });

  it('parses scientific notation', () => {
    const toks = tokenize('1.5e-2');
    expect(toks[0].value).toBeCloseTo(0.015);
  });

  it('skips line comments', () => {
    const toks = tokenize('// hello\nx := 1;');
    expect(toks[0].kind).toBe('identifier');
  });

  it('skips block comments', () => {
    const toks = tokenize('(* a multi\nline *) x := 1;');
    expect(toks[0].kind).toBe('identifier');
  });
});

describe('parser', () => {
  it('parses a bare statement block (no PROGRAM/END_PROGRAM)', () => {
    const res = compile('x := 1.0;');
    expect(res.ok).toBe(true);
    expect(res.program?.body).toHaveLength(1);
  });

  it('parses VAR block + IF/THEN/ELSE', () => {
    const res = compile(`
      VAR
        x: REAL := 0.0;
        ok: BOOL := FALSE;
      END_VAR
      IF x > 5.0 THEN
        ok := TRUE;
      ELSE
        ok := FALSE;
      END_IF
    `);
    expect(res.ok).toBe(true);
    expect(res.program?.vars).toHaveLength(2);
  });

  it('reports a useful error on missing semicolon', () => {
    const res = compile('x := 1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Expected');
  });
});

describe('interpreter', () => {
  it('evaluates arithmetic precedence', () => {
    const env = execute('y := 2 + 3 * 4;');
    expect(env.outputs.y).toBe(14);
  });

  it('honors parentheses', () => {
    const env = execute('y := (2 + 3) * 4;');
    expect(env.outputs.y).toBe(20);
  });

  it('reads inputs', () => {
    const env = execute('y := sensed + 10;', { sensed: 72 });
    expect(env.outputs.y).toBe(82);
  });

  it('refuses to assign to inputs', () => {
    const env = execute('sensed := 99;', { sensed: 72 });
    expect(env.outputs.sensed).toBeUndefined();
    expect(env.warnings.length).toBeGreaterThan(0);
    expect(env.warnings[0]).toContain('sensed');
  });

  it('IF/THEN takes branch when condition is true', () => {
    const env = execute(
      `IF sensed > 70.0 THEN
         cooling := 1.0;
       ELSE
         cooling := 0.0;
       END_IF`,
      { sensed: 75 },
    );
    expect(env.outputs.cooling).toBe(1);
  });

  it('IF/THEN takes ELSE branch when false', () => {
    const env = execute(
      `IF sensed > 70.0 THEN
         cooling := 1.0;
       ELSE
         cooling := 0.0;
       END_IF`,
      { sensed: 68 },
    );
    expect(env.outputs.cooling).toBe(0);
  });

  it('ELSIF chains evaluate top-to-bottom', () => {
    const src = `
      IF temp > 80.0 THEN
        mode := 3.0;
      ELSIF temp > 70.0 THEN
        mode := 2.0;
      ELSIF temp > 60.0 THEN
        mode := 1.0;
      ELSE
        mode := 0.0;
      END_IF`;
    expect(execute(src, { temp: 85 }).outputs.mode).toBe(3);
    expect(execute(src, { temp: 75 }).outputs.mode).toBe(2);
    expect(execute(src, { temp: 65 }).outputs.mode).toBe(1);
    expect(execute(src, { temp: 50 }).outputs.mode).toBe(0);
  });

  it('AND short-circuits', () => {
    // Should not throw on the right side (division by zero would be a warning, not error)
    const env = execute(
      `IF (a > 0) AND (b / a > 1) THEN
         hit := 1.0;
       ELSE
         hit := 0.0;
       END_IF`,
      { a: 0, b: 5 },
    );
    expect(env.outputs.hit).toBe(0);
    // a is zero, so we never evaluated b/a — no divide-by-zero warning.
    expect(env.warnings).not.toContain('division by zero');
  });

  it('MIN / MAX built-ins', () => {
    expect(execute('y := MIN(1.0, 2.0, 0.5);').outputs.y).toBe(0.5);
    expect(execute('y := MAX(1.0, 2.0, 0.5);').outputs.y).toBe(2);
  });

  it('CLAMP built-in', () => {
    expect(execute('y := CLAMP(15.0, 0.0, 10.0);').outputs.y).toBe(10);
    expect(execute('y := CLAMP(-5.0, 0.0, 10.0);').outputs.y).toBe(0);
    expect(execute('y := CLAMP(5.0, 0.0, 10.0);').outputs.y).toBe(5);
  });

  it('PID built-in retains integrator state across calls', () => {
    const src = `actuator := PID(error, 0.1, 0.05, 0.0);`;
    const res = compile(src);
    expect(res.ok).toBe(true);
    const env = makeEnv({ inputs: { error: 5 }, dt: 1 });
    runProgram(res.program!, env);
    const first = env.outputs.actuator;
    // Push another tick at same error: integrator should accumulate, output should grow
    const env2 = makeEnv({ inputs: { error: 5 }, dt: 1, state: env.state });
    runProgram(res.program!, env2);
    expect(env2.outputs.actuator).toBeGreaterThan(first);
  });

  it('VAR initializers run once', () => {
    const src = `
      VAR
        counter: REAL := 0.0;
      END_VAR
      counter := counter + 1.0;
      out := counter;`;
    const res = compile(src);
    expect(res.ok).toBe(true);
    const state: Record<string, number> = {};
    const env1 = makeEnv({ state });
    runProgram(res.program!, env1);
    const env2 = makeEnv({ state });
    runProgram(res.program!, env2);
    const env3 = makeEnv({ state });
    runProgram(res.program!, env3);
    expect(env3.outputs.out).toBe(3);
  });

  it('reports undefined identifier in expression position', () => {
    const res = compile('x := mystery + 1.0;');
    expect(res.ok).toBe(true);
    const env = makeEnv({});
    expect(() => runProgram(res.program!, env)).toThrow(/Undefined identifier "mystery"/);
  });

  it('reports unknown function', () => {
    const res = compile('x := WIDGET(1.0);');
    expect(res.ok).toBe(true);
    expect(() => runProgram(res.program!, makeEnv({}))).toThrow(/Unknown function/);
  });

  it('division by zero is a warning, not a throw', () => {
    const env = execute('y := 1.0 / 0.0;');
    expect(env.outputs.y).toBe(0);
    expect(env.warnings).toContain('division by zero');
  });

  it('full PROGRAM/END_PROGRAM block parses and runs', () => {
    const src = `
      PROGRAM CoolingLoop
      VAR
        deadband: REAL := 2.0;
      END_VAR
      IF sensed > setpoint + deadband THEN
        actuator := 1.0;
      ELSIF sensed < setpoint - deadband THEN
        actuator := 0.0;
      END_IF
      END_PROGRAM`;
    const env = execute(src, { sensed: 78, setpoint: 72 });
    expect(env.outputs.actuator).toBe(1);
  });
});
