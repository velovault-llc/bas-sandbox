// @bas/core/fbd — IEC 61131-3 Function Block Diagram.
//
// Public API: a vendor-neutral block-graph compiler that emits ST source
// runnable by the existing ST interpreter. See ./blocks.ts for the block
// library, ./compile.ts for the graph compiler.

export { BLOCK_LIBRARY, emitBlock } from './blocks.js';
export type { BlockTypeDef, BlockPort, PortType } from './blocks.js';
export { compileFbd } from './compile.js';
export type { FbdGraph, FbdNode, FbdEdge, FbdCompileResult } from './compile.js';
