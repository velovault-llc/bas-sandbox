// Convert a parsed Metasys topology (from the dbexport-parser) into a
// BuildCanvas-shaped { nodes, edges } structure so the user can drop a real
// .dbexport and continue working with it in the simulator.
//
// Scope tradeoffs:
//   - Engines become Supervisor nodes.
//   - "equipment" kind in the parsed hierarchy becomes Controller nodes.
//   - Points / alarms / trend logs are intentionally NOT imported — a real
//     .dbexport carries 5–15 k objects and xyflow gets sluggish past ~500
//     nodes. We cap at the equipment level (10s–100s of nodes) which is
//     plenty to wire up a meaningful sim run.
//   - Each engine gets its first N equipment nodes imported (N = 24 by
//     default) so wide sites don't blow up the canvas. Truncated count is
//     reported back so the UI can surface it.
//   - Trunk kinds are inferred from the parser's segment-categorization
//     (fieldbus → MS/TP, n2trunk → N2, bacnettrunk → BACnet/IP, lontrunk → LON).

import type { Edge, Node } from '@xyflow/svelte';
import type { TopologyNode } from '@bas/core';

export type ImportedWireKind = 'mstp' | 'n2' | 'bacnet-ip' | 'lon' | 'hardwired';

export type ImportSummary = {
  engineCount: number;
  controllerCount: number;
  truncated: number;
};

export type ImportResult = {
  nodes: Node[];
  edges: Edge[];
  summary: ImportSummary;
};

const MAX_CONTROLLERS_PER_ENGINE = 24;

// Layout constants — simple grid, no auto-layout library.
const ENGINE_Y = 60;
const CONTROLLER_Y_START = 220;
const CONTROLLER_ROW_GAP = 130;
const CONTROLLER_COL_GAP = 200;
const COLS_PER_ROW = 4;
const ENGINE_BLOCK_MIN_WIDTH = COLS_PER_ROW * CONTROLLER_COL_GAP + 80;

export function topologyToCanvas(topology: readonly TopologyNode[]): ImportResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nextNumeric = 1;
  let engineX = 100;
  let totalControllers = 0;
  let truncated = 0;

  for (const engine of topology) {
    const engineId = `imp-${nextNumeric++}`;
    nodes.push({
      id: engineId,
      type: 'bas',
      position: { x: engineX, y: ENGINE_Y },
      data: { kind: 'supervisor', label: engine.label },
    });

    // Walk the engine subtree, accumulating equipment nodes + the trunk kind
    // they hang off of.
    const collected: { node: TopologyNode; trunkKind: ImportedWireKind }[] = [];
    walkEquipment(engine, 'bacnet-ip', collected);

    // Engine block is at least one row wide.
    const useCount = Math.min(collected.length, MAX_CONTROLLERS_PER_ENGINE);
    truncated += collected.length - useCount;
    totalControllers += useCount;

    for (let i = 0; i < useCount; i++) {
      const { node: ctrl, trunkKind } = collected[i];
      const ctrlId = `imp-${nextNumeric++}`;
      const row = Math.floor(i / COLS_PER_ROW);
      const col = i % COLS_PER_ROW;
      const baseX = engineX - ((COLS_PER_ROW - 1) * CONTROLLER_COL_GAP) / 2;
      nodes.push({
        id: ctrlId,
        type: 'bas',
        position: {
          x: baseX + col * CONTROLLER_COL_GAP,
          y: CONTROLLER_Y_START + row * CONTROLLER_ROW_GAP,
        },
        data: { kind: 'controller', label: ctrl.label.slice(0, 40) },
      });
      edges.push({
        id: `imp-e-${engineId}-${ctrlId}`,
        source: engineId,
        target: ctrlId,
        data: { wireKind: trunkKind },
      });
    }

    const blockWidth = Math.max(ENGINE_BLOCK_MIN_WIDTH, COLS_PER_ROW * CONTROLLER_COL_GAP);
    engineX += blockWidth + 40;
  }

  return {
    nodes,
    edges,
    summary: { engineCount: topology.length, controllerCount: totalControllers, truncated },
  };
}

function walkEquipment(
  node: TopologyNode,
  inheritedTrunk: ImportedWireKind,
  out: { node: TopologyNode; trunkKind: ImportedWireKind }[],
): void {
  for (const child of node.children) {
    const childTrunk = trunkKindForCategory(child.kind) ?? inheritedTrunk;

    if (isEquipmentLike(child.kind)) {
      out.push({ node: child, trunkKind: childTrunk });
      // Do NOT recurse into equipment — its descendants are points / config
      // we don't want to import as separate canvas nodes.
      continue;
    }
    if (isLeafKind(child.kind)) {
      // Skip points / alarms / trendlogs / schedules / graphics.
      continue;
    }
    // Otherwise it's a category/folder/trunk — recurse.
    walkEquipment(child, childTrunk, out);
  }
}

function trunkKindForCategory(kind: string): ImportedWireKind | null {
  switch (kind) {
    case 'fieldbus':
      return 'mstp';
    case 'n2trunk':
      return 'n2';
    case 'bacnettrunk':
      return 'bacnet-ip';
    case 'lontrunk':
      return 'lon';
    default:
      return null;
  }
}

function isEquipmentLike(kind: string): boolean {
  return kind === 'equipment';
}

function isLeafKind(kind: string): boolean {
  return (
    kind === 'point' ||
    kind === 'alarm' ||
    kind === 'trendlog' ||
    kind === 'schedule' ||
    kind === 'graphic' ||
    kind === 'logic'
  );
}
