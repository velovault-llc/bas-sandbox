// Convert a parsed Metasys topology (from the dbexport-parser) into a
// BuildCanvas-shaped { nodes, edges } structure so the user can drop a real
// .dbexport and continue working with it in the simulator.
//
// Scope tradeoffs:
//   - The ADX (Application Data Server) sits at the top: it's the database
//     host, BACnet/IP routes between it and the field engines.
//   - NAE / NCE / SNE engines become Supervisor nodes below the ADX, wired
//     to it via BACnet/IP.
//   - "equipment" kind in the parsed hierarchy becomes Controller nodes
//     hanging off their engine on whatever trunk type was inferred from
//     the parsed segment category (FC-* → MS/TP, N2 → N2, etc.).
//   - SCT, GraphicAssets, Cdm*, $site / $Generic / $Facility folders, and
//     anything starting with "Schedule" or "Programming" are filtered out
//     — they're software tools or virtual archive folders, not devices.
//   - Points / alarms / trend logs / schedules / graphics / logic are
//     intentionally NOT imported. A real .dbexport carries 5–15 k objects
//     and xyflow gets sluggish past ~500 nodes; capping at the equipment
//     level gives 10s–100s of nodes per typical site.
//   - Per-engine cap: 8 controllers (sorted by parse order). Excess are
//     reported in the summary's `truncated` count.

import type { Edge, Node } from '@xyflow/svelte';
import type { TopologyNode } from '@bas/core';

export type ImportedWireKind = 'mstp' | 'n2' | 'bacnet-ip' | 'lon' | 'hardwired';

export type ImportSummary = {
  adxCount: number;
  engineCount: number;
  controllerCount: number;
  skipped: string[];
  truncated: number;
};

export type ImportResult = {
  nodes: Node[];
  edges: Edge[];
  summary: ImportSummary;
};

const MAX_CONTROLLERS_PER_ENGINE = 8;

// Layout — ADX on top, engines in a grid below, controllers in a tight 2-col
// column under each engine. Designed to keep a 17-engine site visible in a
// 2-3 row band rather than one extreme horizontal strip.
const ADX_Y = 40;
const ENGINE_ROW_Y_START = 200;
const ENGINE_GRID_COLS = 4;
const ENGINE_BLOCK_WIDTH = 360;
const ENGINE_BLOCK_HEIGHT = 460;
const CONTROLLER_Y_OFFSET = 130;
const CONTROLLER_ROW_GAP = 70;
const CONTROLLER_COL_GAP = 170;
const CONTROLLERS_PER_ROW = 2;

/** JCI software tools, virtual folders, and well-known non-device top-level entries. */
function shouldSkip(label: string): boolean {
  if (/^SCT$/i.test(label)) return true;
  if (/GraphicAssets/i.test(label)) return true;
  if (/^Cdm/i.test(label)) return true;
  if (/^\$/.test(label)) return true; // $site, $Generic, $Facility
  if (/^Schedule/i.test(label)) return true;
  if (/^Programming$/i.test(label)) return true;
  if (/^Graphics$/i.test(label)) return true;
  if (/^System Programs$/i.test(label)) return true;
  return false;
}

/** ADX = Application Data Server / Application Data Server eXtended. Top tier. */
function isAdx(label: string): boolean {
  return /\b(ADX|ADS)\b|-ADX-|-ADS-/i.test(label);
}

export function topologyToCanvas(topology: readonly TopologyNode[]): ImportResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nextNumeric = 1;
  let totalControllers = 0;
  let truncated = 0;
  const skipped: string[] = [];

  // First pass: split top-level entries into ADX / engines / skip.
  const adxes: TopologyNode[] = [];
  const engines: TopologyNode[] = [];
  for (const t of topology) {
    if (shouldSkip(t.label)) {
      skipped.push(t.label);
      continue;
    }
    if (isAdx(t.label)) {
      adxes.push(t);
    } else {
      engines.push(t);
    }
  }

  // Total width consumed by the engine grid (or a single column if few engines).
  const cols = Math.min(ENGINE_GRID_COLS, Math.max(engines.length, 1));
  const gridWidth = cols * ENGINE_BLOCK_WIDTH;
  const adxX = gridWidth / 2; // center

  // ADX nodes — place horizontally near the center top.
  const adxIds: string[] = [];
  for (let i = 0; i < adxes.length; i++) {
    const id = `imp-${nextNumeric++}`;
    nodes.push({
      id,
      type: 'bas',
      position: {
        x: adxX + (i - (adxes.length - 1) / 2) * 220,
        y: ADX_Y,
      },
      data: { kind: 'supervisor', label: adxes[i].label, note: 'ADX' },
    });
    adxIds.push(id);
  }

  // Engines grid below the ADX(es).
  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i];
    const row = Math.floor(i / ENGINE_GRID_COLS);
    const col = i % ENGINE_GRID_COLS;
    const engineX = col * ENGINE_BLOCK_WIDTH + ENGINE_BLOCK_WIDTH / 2;
    const engineY = ENGINE_ROW_Y_START + row * ENGINE_BLOCK_HEIGHT;

    const engineId = `imp-${nextNumeric++}`;
    nodes.push({
      id: engineId,
      type: 'bas',
      position: { x: engineX, y: engineY },
      data: { kind: 'supervisor', label: engine.label },
    });

    // Wire engine up to the nearest ADX via BACnet/IP. With multiple ADXes we
    // pick the closest by x-coordinate to keep edges tidy.
    if (adxIds.length > 0) {
      const nearestAdxIdx = adxes
        .map((_, j) => ({ idx: j, dx: Math.abs(j * 220 - col * ENGINE_BLOCK_WIDTH) }))
        .sort((a, b) => a.dx - b.dx)[0]?.idx ?? 0;
      edges.push({
        id: `imp-e-${adxIds[nearestAdxIdx]}-${engineId}`,
        source: adxIds[nearestAdxIdx],
        target: engineId,
        data: { wireKind: 'bacnet-ip' },
      });
    }

    // Collect equipment under this engine.
    const controllers: { node: TopologyNode; trunkKind: ImportedWireKind }[] = [];
    walkEquipment(engine, 'bacnet-ip', controllers);

    const useCount = Math.min(controllers.length, MAX_CONTROLLERS_PER_ENGINE);
    truncated += controllers.length - useCount;
    totalControllers += useCount;

    for (let j = 0; j < useCount; j++) {
      const { node: ctrl, trunkKind } = controllers[j];
      const ctrlId = `imp-${nextNumeric++}`;
      const cRow = Math.floor(j / CONTROLLERS_PER_ROW);
      const cCol = j % CONTROLLERS_PER_ROW;
      const cX = engineX + (cCol - (CONTROLLERS_PER_ROW - 1) / 2) * CONTROLLER_COL_GAP;
      const cY = engineY + CONTROLLER_Y_OFFSET + cRow * CONTROLLER_ROW_GAP;
      nodes.push({
        id: ctrlId,
        type: 'bas',
        position: { x: cX, y: cY },
        data: { kind: 'controller', label: ctrl.label.slice(0, 32) },
      });
      edges.push({
        id: `imp-e-${engineId}-${ctrlId}`,
        source: engineId,
        target: ctrlId,
        data: { wireKind: trunkKind },
      });
    }
  }

  return {
    nodes,
    edges,
    summary: {
      adxCount: adxes.length,
      engineCount: engines.length,
      controllerCount: totalControllers,
      skipped,
      truncated,
    },
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
    if (shouldSkip(child.label)) {
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
