// IEC 61131-3 Function Block Diagram — block library.
//
// Each block compiles down to a single line of Structured Text. Stateless
// blocks (math, logic, compare, selector) are pure expressions; stateful
// ones (PID — and later TON/SR/SCHEDULE) lean on the ST interpreter's
// existing built-ins for their persistence.
//
// Why this layer exists: BAS techs program in block-graphs because the
// vendors all built their tools around graphs (JCI CCT, Niagara Wiresheet,
// EIKON LogicBuilder, Distech GFX). We can't ship those vendor-specific
// block libraries, but IEC 61131-3 FBD is the underlying standard — the
// concepts and ports are identical, only the icons differ. A tech fluent
// here transfers naturally to any of the proprietary tools.

export type PortType = 'real' | 'bool' | 'int';

export interface BlockPort {
  readonly name: string;
  readonly type: PortType;
  /** Short label shown on the block face when port count > 1. */
  readonly label?: string;
}

export interface BlockTypeDef {
  readonly id: string;
  readonly displayName: string;
  readonly category: 'io' | 'math' | 'logic' | 'compare' | 'select' | 'loop';
  readonly inputs: readonly BlockPort[];
  readonly outputs: readonly BlockPort[];
  /** Configurable static parameters (PID gains, INPUT/OUTPUT name binding, CONST value). */
  readonly params?: readonly { name: string; type: PortType | 'string'; default: number | string | boolean }[];
  /** Marketing-grade one-liner shown in the palette tooltip. */
  readonly description: string;
}

export const BLOCK_LIBRARY: Record<string, BlockTypeDef> = {
  // ── I/O connectors ─────────────────────────────────────────────────────
  INPUT: {
    id: 'INPUT',
    displayName: 'Input',
    category: 'io',
    inputs: [],
    outputs: [{ name: 'q', type: 'real' }],
    params: [{ name: 'source', type: 'string', default: 'sensed' }],
    description:
      'Read a value from the environment: sensed, setpoint, oat, zone, pi_out, dt.',
  },
  OUTPUT: {
    id: 'OUTPUT',
    displayName: 'Output',
    category: 'io',
    inputs: [{ name: 'in', type: 'real' }],
    outputs: [],
    params: [{ name: 'target', type: 'string', default: 'actuator' }],
    description:
      'Write a value to the environment. Common targets: actuator (0..1), setpoint (°F).',
  },
  CONST: {
    id: 'CONST',
    displayName: 'Const',
    category: 'io',
    inputs: [],
    outputs: [{ name: 'q', type: 'real' }],
    params: [{ name: 'value', type: 'real', default: 0 }],
    description: 'A literal numeric constant.',
  },

  // ── Math ──────────────────────────────────────────────────────────────
  ADD: bin('ADD', 'Add', 'math', '+', 'real'),
  SUB: bin('SUB', 'Subtract', 'math', '-', 'real'),
  MUL: bin('MUL', 'Multiply', 'math', '*', 'real'),
  DIV: bin('DIV', 'Divide', 'math', '/', 'real'),
  MIN: call2('MIN', 'Min', 'math', 'MIN', 'real'),
  MAX: call2('MAX', 'Max', 'math', 'MAX', 'real'),

  // ── Logic (boolean) ────────────────────────────────────────────────────
  AND: bin('AND', 'And', 'logic', 'AND', 'bool'),
  OR: bin('OR', 'Or', 'logic', 'OR', 'bool'),
  NOT: {
    id: 'NOT',
    displayName: 'Not',
    category: 'logic',
    inputs: [{ name: 'in', type: 'bool' }],
    outputs: [{ name: 'q', type: 'bool' }],
    description: 'Boolean negation.',
  },

  // ── Compare ───────────────────────────────────────────────────────────
  GT: bin('GT', 'Greater than', 'compare', '>', 'bool', 'real'),
  LT: bin('LT', 'Less than', 'compare', '<', 'bool', 'real'),
  EQ: bin('EQ', 'Equal', 'compare', '=', 'bool', 'real'),
  GTE: bin('GTE', 'Greater or equal', 'compare', '>=', 'bool', 'real'),
  LTE: bin('LTE', 'Less or equal', 'compare', '<=', 'bool', 'real'),

  // ── Selector ──────────────────────────────────────────────────────────
  SEL: {
    id: 'SEL',
    displayName: 'Selector',
    category: 'select',
    inputs: [
      { name: 'sel', type: 'bool' },
      { name: 'a', type: 'real' },
      { name: 'b', type: 'real' },
    ],
    outputs: [{ name: 'q', type: 'real' }],
    description: 'Output a when sel is TRUE, b when FALSE.',
  },

  // ── Loop ──────────────────────────────────────────────────────────────
  PID: {
    id: 'PID',
    displayName: 'PID',
    category: 'loop',
    inputs: [{ name: 'error', type: 'real' }],
    outputs: [{ name: 'q', type: 'real' }],
    params: [
      { name: 'Kp', type: 'real', default: 0.3 },
      { name: 'Ki', type: 'real', default: 0.001 },
      { name: 'Kd', type: 'real', default: 0 },
    ],
    description:
      'PI(D) loop with anti-windup, output clamped 0..1. Integrator persists across ticks per call site.',
  },
};

// ─── helpers ──────────────────────────────────────────────────────────

function bin(
  id: string,
  displayName: string,
  category: BlockTypeDef['category'],
  _op: string,
  outType: PortType,
  inType: PortType = outType,
): BlockTypeDef {
  return {
    id,
    displayName,
    category,
    inputs: [
      { name: 'a', type: inType },
      { name: 'b', type: inType },
    ],
    outputs: [{ name: 'q', type: outType }],
    description: `${displayName} of two inputs.`,
  };
}

function call2(
  id: string,
  displayName: string,
  category: BlockTypeDef['category'],
  _fn: string,
  outType: PortType,
): BlockTypeDef {
  return {
    id,
    displayName,
    category,
    inputs: [
      { name: 'a', type: outType },
      { name: 'b', type: outType },
    ],
    outputs: [{ name: 'q', type: outType }],
    description: `${displayName} of two inputs.`,
  };
}

/**
 * Emit the ST snippet for a single block instance.
 *
 * @param blockType   The block's library entry.
 * @param instanceId  Unique node id (used to name the output var).
 * @param inputExprs  Already-resolved ST expressions for each input port,
 *                    indexed by input port name. May be string literals
 *                    ("sensed", "5.0") or intermediate var names.
 * @param params      Per-instance config (PID gains, INPUT source name, etc.).
 * @param outputVar   The var name the compiler chose for this block's
 *                    primary output. Subsequent blocks reference this name.
 */
export function emitBlock(
  blockType: BlockTypeDef,
  _instanceId: string,
  inputExprs: Record<string, string>,
  params: Record<string, number | string | boolean>,
  outputVar: string,
): string {
  const id = blockType.id;
  // I/O connectors
  if (id === 'INPUT') {
    const src = String(params.source ?? 'sensed');
    return `${outputVar} := ${src};`;
  }
  if (id === 'OUTPUT') {
    const target = String(params.target ?? 'actuator');
    const inExpr = inputExprs.in ?? '0.0';
    return `${target} := ${inExpr};`;
  }
  if (id === 'CONST') {
    const v = Number(params.value ?? 0);
    return `${outputVar} := ${formatNumber(v)};`;
  }

  // Math / logic / compare — pick the right operator/function
  const a = inputExprs.a ?? '0.0';
  const b = inputExprs.b ?? '0.0';
  switch (id) {
    case 'ADD':
      return `${outputVar} := (${a}) + (${b});`;
    case 'SUB':
      return `${outputVar} := (${a}) - (${b});`;
    case 'MUL':
      return `${outputVar} := (${a}) * (${b});`;
    case 'DIV':
      return `${outputVar} := (${a}) / (${b});`;
    case 'MIN':
      return `${outputVar} := MIN(${a}, ${b});`;
    case 'MAX':
      return `${outputVar} := MAX(${a}, ${b});`;
    case 'AND':
      return `${outputVar} := (${a}) AND (${b});`;
    case 'OR':
      return `${outputVar} := (${a}) OR (${b});`;
    case 'NOT':
      return `${outputVar} := NOT (${inputExprs.in ?? '0'});`;
    case 'GT':
      return `${outputVar} := (${a}) > (${b});`;
    case 'LT':
      return `${outputVar} := (${a}) < (${b});`;
    case 'EQ':
      return `${outputVar} := (${a}) = (${b});`;
    case 'GTE':
      return `${outputVar} := (${a}) >= (${b});`;
    case 'LTE':
      return `${outputVar} := (${a}) <= (${b});`;
    case 'SEL': {
      const sel = inputExprs.sel ?? '0';
      // Compile as: q := IF sel THEN a ELSE b — easier in our ST:
      //   q := (sel * a) + ((1 - sel) * b)  works for numeric sel-as-bool
      // Cleaner: use IF/THEN, but that requires emitting a statement block.
      // Simplest: use the selector arithmetic — sel is 0 or 1.
      return `${outputVar} := ((${sel}) * (${a})) + ((1 - (${sel})) * (${b}));`;
    }
    case 'PID': {
      const error = inputExprs.error ?? '0.0';
      const Kp = formatNumber(Number(params.Kp ?? 0.3));
      const Ki = formatNumber(Number(params.Ki ?? 0.001));
      const Kd = formatNumber(Number(params.Kd ?? 0));
      return `${outputVar} := PID(${error}, ${Kp}, ${Ki}, ${Kd});`;
    }
  }
  // Unknown block — emit a placeholder assignment so the rest of the
  // program compiles. The unknown name becomes 0.
  return `${outputVar} := 0.0; // unknown block ${id}`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return `${n}.0`;
  return String(n);
}
