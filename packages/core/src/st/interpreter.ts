// Tree-walking interpreter for the ST subset.
//
// Each call to `runProgram(program, env)` executes the program body once
// against the supplied environment. Variables declared in the program's
// VAR block start at their init value on first run; subsequent runs keep
// state across ticks (because the same env is reused). Inputs/outputs the
// host wants to expose to the program go in env.inputs / env.outputs.
//
// Built-in functions: MIN, MAX, ABS, AVG, CLAMP, MOD, PID (stateful — see
// below). Add more as scenarios demand.

import type {
  AssignStmt,
  BinaryExpr,
  CallExpr,
  Expr,
  IdentExpr,
  IfStmt,
  Program,
  Statement,
  UnaryExpr,
} from './ast.js';

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'RuntimeError';
  }
}

/**
 * Environment a host (BuildCanvas tick) supplies. Inputs are read-only from
 * the program's perspective; outputs are written into by assignments to
 * matching identifiers. State lives across calls so VAR initializers run
 * only once, on the first call. PID call sites get their own state slot
 * keyed by `pid_<line>`.
 */
export interface Env {
  /** Read-only inputs visible to the program (e.g. sensed, setpoint, oat). */
  readonly inputs: Readonly<Record<string, number>>;
  /** Outputs the program can assign to (e.g. actuator, alarm_high). */
  outputs: Record<string, number>;
  /** Persistent program state — VAR values, PID integrators, last sample. */
  state: Record<string, number>;
  /** Sim time step in seconds. Used by stateful built-ins like PID. */
  dt: number;
  /** Trace of warnings raised this tick (assignment to unknown name, etc.). */
  warnings: string[];
}

export function makeEnv(opts: {
  inputs?: Record<string, number>;
  outputs?: Record<string, number>;
  state?: Record<string, number>;
  dt?: number;
}): Env {
  return {
    inputs: opts.inputs ?? {},
    outputs: opts.outputs ?? {},
    state: opts.state ?? {},
    dt: opts.dt ?? 1,
    warnings: [],
  };
}

/**
 * Execute the program once. Mutates env.outputs, env.state, env.warnings.
 * Throws RuntimeError on hard failures (divide-by-zero, undefined identifier
 * in expression position, unknown function).
 */
export function runProgram(program: Program, env: Env): void {
  // VAR initializers run on first call (when env.state has no entries
  // matching their names). Subsequent calls see the persisted values.
  for (const v of program.vars) {
    if (!(v.name in env.state)) {
      env.state[v.name] = v.init ? evalExpr(v.init, env) : typeDefault(v.type);
    }
  }
  env.warnings = [];
  for (const s of program.body) {
    runStatement(s, env);
  }
}

function typeDefault(_t: 'REAL' | 'INT' | 'BOOL'): number {
  return 0;
}

function runStatement(s: Statement, env: Env): void {
  if (s.kind === 'assign') return runAssign(s, env);
  return runIf(s, env);
}

function runAssign(s: AssignStmt, env: Env): void {
  const value = evalExpr(s.value, env);
  // Assignment to inputs is silently disallowed — log a warning, no write.
  if (s.target in env.inputs) {
    env.warnings.push(`assignment to input "${s.target}" ignored at line ${s.line}`);
    return;
  }
  // Prefer the namespace that already has the variable. If neither has it,
  // create it in outputs (so the host can read it back).
  if (s.target in env.state) {
    env.state[s.target] = value;
    return;
  }
  env.outputs[s.target] = value;
}

function runIf(s: IfStmt, env: Env): void {
  for (const branch of s.branches) {
    const cond = evalExpr(branch.cond, env);
    if (cond !== 0) {
      for (const inner of branch.body) runStatement(inner, env);
      return;
    }
  }
  if (s.elseBody) {
    for (const inner of s.elseBody) runStatement(inner, env);
  }
}

function evalExpr(e: Expr, env: Env): number {
  switch (e.kind) {
    case 'literal':
      return e.value;
    case 'ident':
      return readIdent(e, env);
    case 'unary':
      return evalUnary(e, env);
    case 'binary':
      return evalBinary(e, env);
    case 'call':
      return evalCall(e, env);
  }
}

function readIdent(e: IdentExpr, env: Env): number {
  if (e.name in env.state) return env.state[e.name];
  if (e.name in env.inputs) return env.inputs[e.name];
  if (e.name in env.outputs) return env.outputs[e.name];
  throw new RuntimeError(`Undefined identifier "${e.name}"`, e.line);
}

function evalUnary(e: UnaryExpr, env: Env): number {
  const v = evalExpr(e.arg, env);
  if (e.op === '-') return -v;
  // NOT: any nonzero -> 0, zero -> 1
  return v === 0 ? 1 : 0;
}

function evalBinary(e: BinaryExpr, env: Env): number {
  // Short-circuit AND / OR
  if (e.op === 'AND') {
    const l = evalExpr(e.left, env);
    if (l === 0) return 0;
    return evalExpr(e.right, env) !== 0 ? 1 : 0;
  }
  if (e.op === 'OR') {
    const l = evalExpr(e.left, env);
    if (l !== 0) return 1;
    return evalExpr(e.right, env) !== 0 ? 1 : 0;
  }

  const l = evalExpr(e.left, env);
  const r = evalExpr(e.right, env);

  switch (e.op) {
    case '+':
      return l + r;
    case '-':
      return l - r;
    case '*':
      return l * r;
    case '/':
      if (r === 0) {
        // ST: divide by zero is implementation-defined. We return 0 and
        // raise a warning instead of throwing — keeps the loop running.
        env.warnings.push('division by zero');
        return 0;
      }
      return l / r;
    case 'MOD':
      if (r === 0) {
        env.warnings.push('MOD by zero');
        return 0;
      }
      return l - Math.trunc(l / r) * r;
    case '=':
      return l === r ? 1 : 0;
    case '<>':
      return l !== r ? 1 : 0;
    case '<':
      return l < r ? 1 : 0;
    case '<=':
      return l <= r ? 1 : 0;
    case '>':
      return l > r ? 1 : 0;
    case '>=':
      return l >= r ? 1 : 0;
    case 'XOR':
      return (l !== 0) !== (r !== 0) ? 1 : 0;
    default:
      return 0;
  }
}

// Built-ins. Names are case-insensitive to match ST convention.

type Builtin = (args: number[], env: Env, line: number, callId: string) => number;

const BUILTINS: Record<string, Builtin> = {
  MIN: (args) => Math.min(...args),
  MAX: (args) => Math.max(...args),
  ABS: ([x]) => Math.abs(x),
  AVG: (args) => (args.length > 0 ? args.reduce((s, v) => s + v, 0) / args.length : 0),
  CLAMP: ([x, lo, hi]) => Math.max(lo, Math.min(hi, x)),
  LIMIT: ([x, lo, hi]) => Math.max(lo, Math.min(hi, x)),
  SQRT: ([x]) => Math.sqrt(x),
  ROUND: ([x]) => Math.round(x),
  TRUNC: ([x]) => Math.trunc(x),
  // PID(error, Kp, Ki, Kd) → controller output 0..1, anti-windup clamped.
  // Stateful — keys its integrator and last-error in env.state under
  // `__pid_<callId>_int` / `__pid_<callId>_lastErr`. callId is the source
  // line so multiple PID calls on different lines don't share state.
  PID: ([error, Kp, Ki, Kd], env, _line, callId) => {
    const intKey = `__pid_${callId}_int`;
    const lastKey = `__pid_${callId}_last`;
    const prevInt = env.state[intKey] ?? 0;
    const prevLast = env.state[lastKey] ?? error;
    const integral = prevInt + error * env.dt;
    const derivative = env.dt > 0 ? (error - prevLast) / env.dt : 0;
    const raw = Kp * error + Ki * integral + Kd * derivative;
    const clamped = Math.max(0, Math.min(1, raw));
    // Anti-windup: only persist the integrator when not saturating into
    // the same direction as the error.
    const saturating = (clamped >= 1 && error > 0) || (clamped <= 0 && error < 0);
    env.state[intKey] = saturating ? prevInt : integral;
    env.state[lastKey] = error;
    return clamped;
  },
};

function evalCall(e: CallExpr, env: Env): number {
  const upper = e.name.toUpperCase();
  const fn = BUILTINS[upper];
  if (!fn) {
    throw new RuntimeError(`Unknown function "${e.name}"`, e.line);
  }
  const args = e.args.map((a) => evalExpr(a, env));
  return fn(args, env, e.line, `${upper}_${e.line}`);
}
