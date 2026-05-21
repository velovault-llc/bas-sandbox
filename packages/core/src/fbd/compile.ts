// Compile a Function Block Diagram graph into Structured Text source.
//
// The output is plain ST — it runs through @bas/core's existing compile()
// and runProgram() unchanged. That means everything FBD adds works the
// same way ST text programs do: same env shape, same built-in functions,
// same per-controller state persistence.
//
// Algorithm:
//   1. Validate: every edge endpoint references a node + port that exists,
//      no cycles (FBD with feedback would need a designated 1-tick-delay
//      block — out of scope for first cut).
//   2. Topological sort. Inputs-only blocks (INPUT, CONST) come first;
//      outputs-only blocks (OUTPUT) come last.
//   3. Assign each block's primary output a unique intermediate var name.
//   4. For each block in topo order, resolve its input expressions
//      (constant fallback "0.0" / "FALSE" if a port is unwired) and emit
//      the block's ST snippet.
//   5. Concatenate snippets — result is the program body.

import { BLOCK_LIBRARY, emitBlock, type BlockTypeDef } from './blocks.js';

export interface FbdNode {
  /** Unique node instance id (e.g. xyflow's node id). */
  readonly id: string;
  /** Library block type — must be a key of BLOCK_LIBRARY. */
  readonly blockType: string;
  /** Per-instance config (PID gains, INPUT source name, CONST value). */
  readonly params?: Readonly<Record<string, number | string | boolean>>;
}

export interface FbdEdge {
  readonly from: { readonly nodeId: string; readonly port: string };
  readonly to: { readonly nodeId: string; readonly port: string };
}

export interface FbdGraph {
  readonly nodes: readonly FbdNode[];
  readonly edges: readonly FbdEdge[];
}

export interface FbdCompileResult {
  readonly ok: boolean;
  /** Generated ST source. Always populated when ok === true. */
  readonly source?: string;
  /** First validation/topology error, if any. */
  readonly error?: string;
}

/**
 * Compile a block graph to ST source.
 *
 * Empty graphs compile to an empty program (legal — does nothing each tick).
 * Cycles produce { ok: false, error: 'cycle detected' }.
 * Missing block type produces { ok: false, error: '...unknown block type...' }.
 */
export function compileFbd(graph: FbdGraph): FbdCompileResult {
  const byId = new Map<string, FbdNode>();
  for (const n of graph.nodes) byId.set(n.id, n);

  // Validate block types exist
  for (const n of graph.nodes) {
    if (!(n.blockType in BLOCK_LIBRARY)) {
      return { ok: false, error: `unknown block type "${n.blockType}" on node "${n.id}"` };
    }
  }

  // Build adjacency for topological sort. An edge from A.out to B.in means
  // B depends on A's output, so A must be emitted before B.
  const incoming = new Map<string, number>(); // nodeId -> count of incoming edges
  const outgoing = new Map<string, string[]>(); // nodeId -> list of downstream nodeIds
  for (const n of graph.nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!byId.has(e.from.nodeId) || !byId.has(e.to.nodeId)) {
      return { ok: false, error: `edge references unknown node` };
    }
    incoming.set(e.to.nodeId, (incoming.get(e.to.nodeId) ?? 0) + 1);
    outgoing.get(e.from.nodeId)!.push(e.to.nodeId);
  }

  // Kahn's algorithm
  const order: FbdNode[] = [];
  const queue: string[] = [];
  for (const [id, c] of incoming) if (c === 0) queue.push(id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const next of outgoing.get(id) ?? []) {
      const c = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, c);
      if (c === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) {
    return { ok: false, error: 'cycle detected in block graph' };
  }

  // Assign output var names. Each block's primary output gets a unique
  // identifier like `b<n>` where n is the topo index. Edges look up which
  // var to substitute by `from.nodeId`.
  const outVarFor = new Map<string, string>();
  order.forEach((n, idx) => outVarFor.set(n.id, `b${idx}`));

  // Build a lookup: for each (toNodeId, toPort) -> the source's output var.
  // Unwired input ports default to a typed literal.
  const inputSource = new Map<string, string>(); // key: `${nodeId}.${port}` -> expression
  for (const e of graph.edges) {
    const key = `${e.to.nodeId}.${e.to.port}`;
    const src = outVarFor.get(e.from.nodeId);
    if (src) inputSource.set(key, src);
  }

  // Emit code
  const lines: string[] = [];
  for (const n of order) {
    const def = BLOCK_LIBRARY[n.blockType] as BlockTypeDef;
    const inputExprs: Record<string, string> = {};
    for (const port of def.inputs) {
      const wired = inputSource.get(`${n.id}.${port.name}`);
      inputExprs[port.name] = wired ?? typeDefault(port.type);
    }
    const outputVar = outVarFor.get(n.id)!;
    const params = (n.params ?? {}) as Record<string, number | string | boolean>;
    lines.push(emitBlock(def, n.id, inputExprs, params, outputVar));
  }

  return { ok: true, source: lines.join('\n') };
}

function typeDefault(t: 'real' | 'bool' | 'int'): string {
  if (t === 'bool') return '0'; // FALSE in our boolean-as-number scheme
  return '0.0';
}
