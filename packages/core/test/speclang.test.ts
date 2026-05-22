import { describe, it, expect } from 'vitest';
import {
  compileSpecLang,
  TILE_CATALOG,
  findTileTemplate,
  type SpecRule,
  type SpecProgram,
  type Tile,
} from '../src/speclang/index.js';
import { compile, runProgram, makeEnv } from '../src/st/index.js';

/** Build a Tile from a token. For VALUE tiles, pass the numeric override. */
function t(token: string, override: Partial<Tile> = {}): Tile {
  const tpl = findTileTemplate(token);
  if (!tpl) throw new Error(`unknown tile token: ${token}`);
  return {
    id: `tile-${Math.random()}`,
    kind: tpl.kind,
    token: tpl.token,
    display: tpl.display,
    numericValue: tpl.defaultNumeric,
    units: tpl.defaultUnits,
    ...override,
  };
}

function rule(...tiles: Tile[]): SpecRule {
  return { id: `r-${Math.random()}`, tiles };
}

describe('SpecLang catalog', () => {
  it('contains tiles for the five core categories', () => {
    const kinds = new Set(TILE_CATALOG.map((t) => t.kind));
    expect(kinds.has('trigger')).toBe(true);
    expect(kinds.has('action')).toBe(true);
    expect(kinds.has('subject')).toBe(true);
    expect(kinds.has('actuator')).toBe(true);
    expect(kinds.has('value')).toBe(true);
  });

  it('binds every subject and actuator tile to an env key', () => {
    for (const tile of TILE_CATALOG) {
      if (tile.kind === 'subject' || tile.kind === 'actuator') {
        expect(tile.envKey, `${tile.token} missing envKey`).toBeTruthy();
      }
    }
  });
});

describe('SpecLang compiler — single rule shapes', () => {
  it('compiles "When occupancy is vacant → Close primary damper to 0%"', () => {
    const program: SpecProgram = {
      rules: [
        rule(
          t('when'),
          t('occupancy'),
          t('is'),
          t('vacant'),
          t('close'),
          t('primary-damper'),
          t('to'),
          t('percent-value', { numericValue: 0 }),
        ),
      ],
    };
    const result = compileSpecLang(program);
    expect(result.ok).toBe(true);
    expect(result.source).toContain('IF occ = 0.0 THEN');
    expect(result.source).toContain('actuator := 0.0');
  });

  it('compiles "When zone temp exceeds cooling setpoint by 1°F → Open primary damper to 100%"', () => {
    const program: SpecProgram = {
      rules: [
        rule(
          t('when'),
          t('zone-temp'),
          t('exceeds'),
          t('cooling-setpoint'),
          t('by'),
          t('delta-value', { numericValue: 1 }),
          t('open'),
          t('primary-damper'),
          t('to'),
          t('percent-value', { numericValue: 100 }),
        ),
      ],
    };
    const result = compileSpecLang(program);
    expect(result.ok).toBe(true);
    expect(result.source).toContain('IF sensed > (setpoint + 1.0) THEN');
    expect(result.source).toContain('actuator := 1.0');
  });

  it('compiles "When CO2 exceeds 800 ppm → Open primary damper to 100%"', () => {
    const program: SpecProgram = {
      rules: [
        rule(
          t('when'),
          t('co2'),
          t('exceeds'),
          t('ppm-value', { numericValue: 800 }),
          t('open'),
          t('primary-damper'),
          t('to'),
          t('percent-value', { numericValue: 100 }),
        ),
      ],
    };
    const result = compileSpecLang(program);
    expect(result.ok).toBe(true);
    expect(result.source).toContain('IF co2 > 800.0 THEN');
  });

  it('compiles "Modulate reheat valve to maintain zone temp at heating setpoint"', () => {
    const program: SpecProgram = {
      rules: [
        rule(
          t('when'),
          t('zone-temp'),
          t('is-below'),
          t('heating-setpoint'),
          t('modulate'),
          t('reheat-valve'),
          t('maintain'),
          t('zone-temp'),
          t('at'),
          t('heating-setpoint'),
        ),
      ],
    };
    const result = compileSpecLang(program);
    expect(result.ok).toBe(true);
    expect(result.source).toContain('IF sensed < heating_sp THEN');
    expect(result.source).toMatch(/reheat\s*:=\s*MAX/);
  });
});

describe('SpecLang compiler — error handling', () => {
  it('rejects an empty rule', () => {
    const program: SpecProgram = { rules: [rule()] };
    const result = compileSpecLang(program);
    expect(result.ok).toBe(false);
    expect(result.errors.size).toBe(1);
  });

  it('rejects a rule with no action', () => {
    const program: SpecProgram = {
      rules: [rule(t('when'), t('zone-temp'), t('exceeds'), t('temp-value', { numericValue: 75 }))],
    };
    const result = compileSpecLang(program);
    expect(result.ok).toBe(false);
    const msg = [...result.errors.values()][0];
    expect(msg).toMatch(/no action/i);
  });

  it('rejects a rule with no trigger', () => {
    const program: SpecProgram = {
      rules: [rule(t('open'), t('primary-damper'), t('to'), t('percent-value', { numericValue: 100 }))],
    };
    const result = compileSpecLang(program);
    expect(result.ok).toBe(false);
    const msg = [...result.errors.values()][0];
    expect(msg).toMatch(/trigger|when/i);
  });
});

describe('SpecLang compiler — point binding warnings', () => {
  const program: SpecProgram = {
    rules: [
      rule(
        t('when'),
        t('occupancy'),
        t('is'),
        t('vacant'),
        t('close'),
        t('primary-damper'),
        t('to'),
        t('percent-value', { numericValue: 0 }),
      ),
    ],
  };

  it('skips warnings when no bindings provided (backwards compat)', () => {
    const result = compileSpecLang(program);
    expect(result.warnings.size).toBe(0);
    expect(result.ok).toBe(true);
  });

  it('warns when a role used in a rule has no physical binding', () => {
    const result = compileSpecLang(program, {
      bindings: [
        // Only damper bound — occupancy is missing.
        { terminalId: 'AO-1', role: 'primary-damper' },
      ],
    });
    expect(result.ok).toBe(true); // warnings don't block compile
    const ruleWarnings = result.warnings.get(program.rules[0].id) ?? [];
    expect(ruleWarnings.length).toBe(1);
    expect(ruleWarnings[0]).toContain('occupancy');
  });

  it('no warnings when every role is bound', () => {
    const result = compileSpecLang(program, {
      bindings: [
        { terminalId: 'UI-1', role: 'occupancy', sourceNodeId: 'n2' },
        { terminalId: 'AO-1', role: 'primary-damper' },
      ],
    });
    expect(result.warnings.size).toBe(0);
  });
});

describe('SpecLang end-to-end — VAV scenario equivalent', () => {
  /** Build the VAV starter program in SpecLang. The runtime checks from the
   *  VAV scenario should pass against the compiled ST output. */
  const vavProgram: SpecProgram = {
    rules: [
      // Default: occupied ventilation min = 20%
      rule(
        t('when'),
        t('occupancy'),
        t('is'),
        t('occupied'),
        t('open'),
        t('primary-damper'),
        t('to'),
        t('percent-value', { numericValue: 20 }),
      ),
      // Cooling: damper to 100% when warm
      rule(
        t('when'),
        t('zone-temp'),
        t('exceeds'),
        t('cooling-setpoint'),
        t('by'),
        t('delta-value', { numericValue: 1 }),
        t('open'),
        t('primary-damper'),
        t('to'),
        t('percent-value', { numericValue: 100 }),
      ),
      // Unoccupied: damper closed
      rule(
        t('when'),
        t('occupancy'),
        t('is'),
        t('vacant'),
        t('close'),
        t('primary-damper'),
        t('to'),
        t('percent-value', { numericValue: 0 }),
      ),
    ],
  };

  it('compiles cleanly', () => {
    const result = compileSpecLang(vavProgram);
    expect(result.ok).toBe(true);
    expect(result.source.length).toBeGreaterThan(50);
  });

  it('compiled ST passes the VAV "warm zone, occupied → damper at 100%" check', () => {
    const result = compileSpecLang(vavProgram);
    const st = compile(result.source);
    expect(st.ok).toBe(true);
    if (!st.ok || !st.program) throw new Error('ST compile failed: ' + st.error);
    const env = makeEnv({
      inputs: { sensed: 78, setpoint: 72, occ: 1 },
      outputs: {},
      state: {},
      dt: 1,
    });
    runProgram(st.program, env);
    // Last rule wins among matching rules — warm + occupied → 100% (rule 2 fires after rule 1).
    expect(env.outputs.actuator).toBeCloseTo(1.0, 2);
  });

  it('compiled ST passes "zone at setpoint, occupied → damper at 20% ventilation min"', () => {
    const result = compileSpecLang(vavProgram);
    const st = compile(result.source);
    if (!st.ok || !st.program) throw new Error('ST compile failed');
    const env = makeEnv({
      inputs: { sensed: 72, setpoint: 72, occ: 1 },
      outputs: {},
      state: {},
      dt: 1,
    });
    runProgram(st.program, env);
    expect(env.outputs.actuator).toBeCloseTo(0.2, 2);
  });

  it('compiled ST passes "unoccupied → damper closed"', () => {
    const result = compileSpecLang(vavProgram);
    const st = compile(result.source);
    if (!st.ok || !st.program) throw new Error('ST compile failed');
    const env = makeEnv({
      inputs: { sensed: 72, setpoint: 72, occ: 0 },
      outputs: {},
      state: {},
      dt: 1,
    });
    runProgram(st.program, env);
    expect(env.outputs.actuator).toBeCloseTo(0.0, 2);
  });
});
