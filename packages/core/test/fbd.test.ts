import { describe, expect, it } from 'vitest';
import { BLOCK_LIBRARY, compile, compileFbd, makeEnv, runProgram, type FbdGraph } from '../src/index.js';

describe('block library', () => {
  it('exposes the expected blocks', () => {
    const expected = ['INPUT', 'OUTPUT', 'CONST', 'ADD', 'SUB', 'MUL', 'DIV', 'MIN', 'MAX', 'AND', 'OR', 'NOT', 'GT', 'LT', 'EQ', 'GTE', 'LTE', 'SEL', 'PID'];
    for (const id of expected) {
      expect(BLOCK_LIBRARY[id], `missing block ${id}`).toBeDefined();
    }
  });

  it('every block has at least one output port (except OUTPUT)', () => {
    for (const def of Object.values(BLOCK_LIBRARY)) {
      if (def.id === 'OUTPUT') continue;
      expect(def.outputs.length).toBeGreaterThan(0);
    }
  });
});

describe('compileFbd', () => {
  function exec(graph: FbdGraph, inputs: Record<string, number> = {}, dt = 1) {
    const fbd = compileFbd(graph);
    if (!fbd.ok) throw new Error(fbd.error);
    const st = compile(fbd.source!);
    if (!st.ok) throw new Error(`ST compile failed: ${st.error}\n--- SRC ---\n${fbd.source}`);
    const env = makeEnv({ inputs, dt });
    runProgram(st.program!, env);
    return { env, source: fbd.source };
  }

  it('compiles an empty graph to empty source', () => {
    const res = compileFbd({ nodes: [], edges: [] });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('');
  });

  it('compiles INPUT -> OUTPUT (simple passthrough)', () => {
    const { env } = exec(
      {
        nodes: [
          { id: 'i', blockType: 'INPUT', params: { source: 'sensed' } },
          { id: 'o', blockType: 'OUTPUT', params: { target: 'actuator' } },
        ],
        edges: [{ from: { nodeId: 'i', port: 'q' }, to: { nodeId: 'o', port: 'in' } }],
      },
      { sensed: 42 },
    );
    expect(env.outputs.actuator).toBe(42);
  });

  it('compiles CONST -> OUTPUT', () => {
    const { env } = exec({
      nodes: [
        { id: 'c', blockType: 'CONST', params: { value: 0.5 } },
        { id: 'o', blockType: 'OUTPUT', params: { target: 'actuator' } },
      ],
      edges: [{ from: { nodeId: 'c', port: 'q' }, to: { nodeId: 'o', port: 'in' } }],
    });
    expect(env.outputs.actuator).toBe(0.5);
  });

  it('compiles SUB (sensed - setpoint)', () => {
    const { env } = exec(
      {
        nodes: [
          { id: 'a', blockType: 'INPUT', params: { source: 'sensed' } },
          { id: 'b', blockType: 'INPUT', params: { source: 'setpoint' } },
          { id: 's', blockType: 'SUB' },
          { id: 'o', blockType: 'OUTPUT', params: { target: 'error_out' } },
        ],
        edges: [
          { from: { nodeId: 'a', port: 'q' }, to: { nodeId: 's', port: 'a' } },
          { from: { nodeId: 'b', port: 'q' }, to: { nodeId: 's', port: 'b' } },
          { from: { nodeId: 's', port: 'q' }, to: { nodeId: 'o', port: 'in' } },
        ],
      },
      { sensed: 75, setpoint: 70 },
    );
    expect(env.outputs.error_out).toBe(5);
  });

  it('compiles a full PID loop (sensed - setpoint -> PID -> actuator)', () => {
    const { env, source } = exec(
      {
        nodes: [
          { id: 'sensed', blockType: 'INPUT', params: { source: 'sensed' } },
          { id: 'sp', blockType: 'INPUT', params: { source: 'setpoint' } },
          { id: 'err', blockType: 'SUB' },
          { id: 'pid', blockType: 'PID', params: { Kp: 0.5, Ki: 0.01, Kd: 0 } },
          { id: 'out', blockType: 'OUTPUT', params: { target: 'actuator' } },
        ],
        edges: [
          { from: { nodeId: 'sensed', port: 'q' }, to: { nodeId: 'err', port: 'a' } },
          { from: { nodeId: 'sp', port: 'q' }, to: { nodeId: 'err', port: 'b' } },
          { from: { nodeId: 'err', port: 'q' }, to: { nodeId: 'pid', port: 'error' } },
          { from: { nodeId: 'pid', port: 'q' }, to: { nodeId: 'out', port: 'in' } },
        ],
      },
      { sensed: 78, setpoint: 72 },
    );
    // error = 6, Kp*err = 3 — but PID clamps to 0..1 so result is 1.0
    expect(env.outputs.actuator).toBe(1);
    expect(source).toContain('PID(');
  });

  it('compiles GT compare + SEL', () => {
    const src = exec(
      {
        nodes: [
          { id: 's', blockType: 'INPUT', params: { source: 'sensed' } },
          { id: 'sp', blockType: 'INPUT', params: { source: 'setpoint' } },
          { id: 'gt', blockType: 'GT' },
          { id: 'one', blockType: 'CONST', params: { value: 1 } },
          { id: 'zero', blockType: 'CONST', params: { value: 0 } },
          { id: 'sel', blockType: 'SEL' },
          { id: 'o', blockType: 'OUTPUT', params: { target: 'actuator' } },
        ],
        edges: [
          { from: { nodeId: 's', port: 'q' }, to: { nodeId: 'gt', port: 'a' } },
          { from: { nodeId: 'sp', port: 'q' }, to: { nodeId: 'gt', port: 'b' } },
          { from: { nodeId: 'gt', port: 'q' }, to: { nodeId: 'sel', port: 'sel' } },
          { from: { nodeId: 'one', port: 'q' }, to: { nodeId: 'sel', port: 'a' } },
          { from: { nodeId: 'zero', port: 'q' }, to: { nodeId: 'sel', port: 'b' } },
          { from: { nodeId: 'sel', port: 'q' }, to: { nodeId: 'o', port: 'in' } },
        ],
      },
      { sensed: 78, setpoint: 72 },
    );
    expect(src.env.outputs.actuator).toBe(1);

    const src2 = exec(
      {
        nodes: [
          { id: 's', blockType: 'INPUT', params: { source: 'sensed' } },
          { id: 'sp', blockType: 'INPUT', params: { source: 'setpoint' } },
          { id: 'gt', blockType: 'GT' },
          { id: 'one', blockType: 'CONST', params: { value: 1 } },
          { id: 'zero', blockType: 'CONST', params: { value: 0 } },
          { id: 'sel', blockType: 'SEL' },
          { id: 'o', blockType: 'OUTPUT', params: { target: 'actuator' } },
        ],
        edges: [
          { from: { nodeId: 's', port: 'q' }, to: { nodeId: 'gt', port: 'a' } },
          { from: { nodeId: 'sp', port: 'q' }, to: { nodeId: 'gt', port: 'b' } },
          { from: { nodeId: 'gt', port: 'q' }, to: { nodeId: 'sel', port: 'sel' } },
          { from: { nodeId: 'one', port: 'q' }, to: { nodeId: 'sel', port: 'a' } },
          { from: { nodeId: 'zero', port: 'q' }, to: { nodeId: 'sel', port: 'b' } },
          { from: { nodeId: 'sel', port: 'q' }, to: { nodeId: 'o', port: 'in' } },
        ],
      },
      { sensed: 65, setpoint: 72 },
    );
    expect(src2.env.outputs.actuator).toBe(0);
  });

  it('detects cycles', () => {
    const res = compileFbd({
      nodes: [
        { id: 'a', blockType: 'ADD' },
        { id: 'b', blockType: 'ADD' },
      ],
      edges: [
        { from: { nodeId: 'a', port: 'q' }, to: { nodeId: 'b', port: 'a' } },
        { from: { nodeId: 'b', port: 'q' }, to: { nodeId: 'a', port: 'a' } },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('cycle');
  });

  it('rejects unknown block types', () => {
    const res = compileFbd({
      nodes: [{ id: 'x', blockType: 'WIDGET' }],
      edges: [],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('WIDGET');
  });

  it('unwired inputs default to a typed literal (real → 0.0, bool → 0)', () => {
    // OUTPUT with no wired `in` should write 0 to its target.
    const { env } = exec({
      nodes: [{ id: 'o', blockType: 'OUTPUT', params: { target: 'actuator' } }],
      edges: [],
    });
    expect(env.outputs.actuator).toBe(0);
  });
});
