// Convert a parsed Metasys topology (from the dbexport-parser) into a
// BuildCanvas-shaped { nodes, edges } structure so the user can drop a real
// .dbexport and continue working with it in the simulator.
//
// Hierarchy mapping:
//   - ADX (Application Data Server) → top-tier Supervisor, tagged note="ADX".
//   - NAE / NCE / SNE engines        → Supervisor nodes below the ADX, wired
//                                      up via BACnet/IP.
//   - "equipment" kind under an engine → Controller node wired to its engine
//                                        on whatever trunk type was inferred
//                                        from the parsed segment category
//                                        (FC-* → MS/TP, N2 → N2, etc.).
//   - SCT, GraphicAssets, Cdm*, $site / $Generic / $Facility, Schedule*,
//     Programming, Graphics, System Programs → filtered out (software tools
//     or virtual archive folders, not devices).
//
// Drill-in behavior:
//   - Engine nodes are imported with data.childCount (N controllers) and
//     data.collapsed = true.
//   - Their controllers are imported but flagged hidden=true (and so are the
//     edges connecting them to their engine).
//   - BuildCanvas treats supervisor clicks with childCount>0 as "toggle
//     expand": flips hidden on all controllers/edges tagged
//     data.importedFromEngine === <this engine's id>.
//   - No per-engine cap. A real archive's 40-FEC engine imports all 40 — the
//     user just sees a "▶ 40 children" indicator until they click to expand.

import type { Edge, Node } from '@xyflow/svelte';
import type { TopologyNode } from '@bas/core';
import {
  decodeValue,
  type MetasysObject,
  type ParsedArchive,
} from '@velovault/dbexport-parser';

// Property IDs from the JCI Launcher dictionary that carry network /
// device-identity metadata worth surfacing on a canvas node.
const PROP_IDS = {
  MODEL_NAME: '70',
  HOST_NAME: '750',
  IP_ADDRESS: '1135',
  IP_ROUTER: '1137',
  ETH_MAC: '1134',
  MAC_ADDRESS: '2858',
  N2_NET_ADDRESS: '806',
  N2_POINT_ADDRESS: '808',
  BACNET_INSTANCE: '32589',
  DESCRIPTION: '28',
} as const;

export type DeviceMeta = {
  ip?: string;
  mac?: string;
  hostName?: string;
  bacnetInstance?: string;
  n2Address?: string;
  model?: string;
};

function decodeProp(obj: MetasysObject, propId: string): string | null {
  const raw = obj.properties[propId];
  if (!raw) return null;
  const decoded = decodeValue(raw);
  return decoded && decoded !== '(empty)' ? decoded.trim() : null;
}

/** Pull the most-useful subset of network / identity properties off a device. */
function extractMeta(obj: MetasysObject): DeviceMeta {
  return {
    ip: decodeProp(obj, PROP_IDS.IP_ADDRESS) ?? undefined,
    mac:
      decodeProp(obj, PROP_IDS.MAC_ADDRESS) ??
      decodeProp(obj, PROP_IDS.ETH_MAC) ??
      undefined,
    hostName: decodeProp(obj, PROP_IDS.HOST_NAME) ?? undefined,
    bacnetInstance: decodeProp(obj, PROP_IDS.BACNET_INSTANCE) ?? undefined,
    n2Address: decodeProp(obj, PROP_IDS.N2_NET_ADDRESS) ?? undefined,
    model: decodeProp(obj, PROP_IDS.MODEL_NAME) ?? undefined,
  };
}

function compactSubtitle(meta: DeviceMeta, isEngine: boolean): string | undefined {
  const parts: string[] = [];
  if (isEngine) {
    if (meta.ip) parts.push(meta.ip);
    else if (meta.hostName) parts.push(meta.hostName);
    if (meta.bacnetInstance) parts.push(`inst ${meta.bacnetInstance}`);
  } else {
    // Controller: prefer MAC (MS/TP) or N2 address, then instance, then IP fallback.
    if (meta.mac) parts.push(`mac ${meta.mac}`);
    else if (meta.n2Address) parts.push(`n2 ${meta.n2Address}`);
    if (meta.bacnetInstance) parts.push(`inst ${meta.bacnetInstance}`);
    if (parts.length === 0 && meta.ip) parts.push(meta.ip);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export type ImportedWireKind = 'mstp' | 'n2' | 'bacnet-ip' | 'lon' | 'hardwired';

export type ImportSummary = {
  adxCount: number;
  engineCount: number;
  controllerCount: number;
  skipped: string[];
};

export type ImportResult = {
  nodes: Node[];
  edges: Edge[];
  summary: ImportSummary;
};

const ADX_Y = 40;
const ENGINE_ROW_Y_START = 200;
const ENGINE_GRID_COLS = 4;
const ENGINE_BLOCK_WIDTH = 360;
const ENGINE_ROW_HEIGHT = 240;
const CONTROLLER_Y_OFFSET = 140;
const CONTROLLER_ROW_GAP = 95;
const CONTROLLER_COL_GAP = 200;
const CONTROLLERS_PER_ROW = 3;

function shouldSkip(label: string): boolean {
  if (/^SCT$/i.test(label)) return true;
  if (/GraphicAssets/i.test(label)) return true;
  if (/^Cdm/i.test(label)) return true;
  if (/^\$/.test(label)) return true;
  if (/^Schedule/i.test(label)) return true;
  if (/^Programming$/i.test(label)) return true;
  if (/^Graphics$/i.test(label)) return true;
  if (/^System Programs$/i.test(label)) return true;
  return false;
}

function isAdx(label: string): boolean {
  return /\b(ADX|ADS)\b|-ADX-|-ADS-/i.test(label);
}

export function topologyToCanvas(
  topology: readonly TopologyNode[],
  archive?: ParsedArchive,
): ImportResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nextNumeric = 1;
  let totalControllers = 0;
  const skipped: string[] = [];

  // ref → MetasysObject lookup so we can enrich nodes with network metadata
  // (IP / MAC / device instance / model name).
  const objByRef = new Map<string, MetasysObject>();
  if (archive) {
    for (const dev of archive.devices) {
      for (const obj of dev.objects) {
        if (obj.ref) objByRef.set(obj.ref, obj);
      }
    }
  }

  function metaForTopologyNode(t: TopologyNode, isEngine: boolean): {
    meta?: DeviceMeta;
    subtitle?: string;
  } {
    if (!t.ref) return {};
    const obj = objByRef.get(t.ref);
    if (!obj) return {};
    const meta = extractMeta(obj);
    const subtitle = compactSubtitle(meta, isEngine);
    return { meta, subtitle };
  }

  const adxes: TopologyNode[] = [];
  const engines: TopologyNode[] = [];
  for (const t of topology) {
    if (shouldSkip(t.label)) {
      skipped.push(t.label);
      continue;
    }
    if (isAdx(t.label)) adxes.push(t);
    else engines.push(t);
  }

  const cols = Math.min(ENGINE_GRID_COLS, Math.max(engines.length, 1));
  const gridWidth = cols * ENGINE_BLOCK_WIDTH;
  const adxX = gridWidth / 2;

  const adxIds: string[] = [];
  for (let i = 0; i < adxes.length; i++) {
    const id = `imp-${nextNumeric++}`;
    const { meta, subtitle } = metaForTopologyNode(adxes[i], true);
    nodes.push({
      id,
      type: 'bas',
      position: {
        x: adxX + (i - (adxes.length - 1) / 2) * 220,
        y: ADX_Y,
      },
      data: { kind: 'supervisor', label: adxes[i].label, note: 'ADX', subtitle, meta },
    });
    adxIds.push(id);
  }

  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i];
    const row = Math.floor(i / ENGINE_GRID_COLS);
    const col = i % ENGINE_GRID_COLS;
    const engineX = col * ENGINE_BLOCK_WIDTH + ENGINE_BLOCK_WIDTH / 2;
    const engineY = ENGINE_ROW_Y_START + row * ENGINE_ROW_HEIGHT;

    // Walk for controllers FIRST so we know childCount before placing the engine.
    const controllers: { node: TopologyNode; trunkKind: ImportedWireKind }[] = [];
    walkEquipment(engine, 'bacnet-ip', controllers);
    totalControllers += controllers.length;

    const engineId = `imp-${nextNumeric++}`;
    const engineMetaInfo = metaForTopologyNode(engine, true);
    nodes.push({
      id: engineId,
      type: 'bas',
      position: { x: engineX, y: engineY },
      data: {
        kind: 'supervisor',
        label: engine.label,
        childCount: controllers.length,
        collapsed: true,
        subtitle: engineMetaInfo.subtitle,
        meta: engineMetaInfo.meta,
      },
    });

    if (adxIds.length > 0) {
      const nearestAdxIdx =
        adxes
          .map((_, j) => ({ idx: j, dx: Math.abs(j * 220 - col * ENGINE_BLOCK_WIDTH) }))
          .sort((a, b) => a.dx - b.dx)[0]?.idx ?? 0;
      edges.push({
        id: `imp-e-${adxIds[nearestAdxIdx]}-${engineId}`,
        source: adxIds[nearestAdxIdx],
        target: engineId,
        data: { wireKind: 'bacnet-ip' },
      });
    }

    // Place every controller (no cap), hidden by default.
    for (let j = 0; j < controllers.length; j++) {
      const { node: ctrl, trunkKind } = controllers[j];
      const ctrlId = `imp-${nextNumeric++}`;
      const cRow = Math.floor(j / CONTROLLERS_PER_ROW);
      const cCol = j % CONTROLLERS_PER_ROW;
      const cX = engineX + (cCol - (CONTROLLERS_PER_ROW - 1) / 2) * CONTROLLER_COL_GAP;
      const cY = engineY + CONTROLLER_Y_OFFSET + cRow * CONTROLLER_ROW_GAP;
      const ctrlMetaInfo = metaForTopologyNode(ctrl, false);
      nodes.push({
        id: ctrlId,
        type: 'bas',
        position: { x: cX, y: cY },
        hidden: true,
        data: {
          kind: 'controller',
          label: ctrl.label.slice(0, 32),
          importedFromEngine: engineId,
          subtitle: ctrlMetaInfo.subtitle,
          meta: ctrlMetaInfo.meta,
        },
      });
      edges.push({
        id: `imp-e-${engineId}-${ctrlId}`,
        source: engineId,
        target: ctrlId,
        hidden: true,
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
      continue;
    }
    if (isLeafKind(child.kind)) continue;
    if (shouldSkip(child.label)) continue;
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
