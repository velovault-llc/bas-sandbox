// Trunk Inspector store — tracks which MS/TP edge (if any) the user has
// opened the trunk inspector against. BuildCanvas writes the latest
// MstpTrunkState here each tick so the inspector renders live data.

import type { MstpTrunkState, MstpFinding, Ipv4Finding } from '@bas/core';

interface TrunkInspectorStore {
  /** Representative-edge-id of the trunk currently being inspected, or null. */
  activeTrunkId: string | null;
  /** Latest snapshot of every trunk's MS/TP state. Mirrors BuildCanvas's
   *  `mstpTrunkStates` Map, written each tick. The inspector reads this
   *  rather than reaching into BuildCanvas internals. */
  byTrunkId: Map<string, MstpTrunkState>;
  /** Latest MS/TP config-validation findings, keyed by trunk id. */
  findingsByTrunkId: Map<string, MstpFinding[]>;
  /** Latest BACnet/IP findings — flat list (each finding names the
   *  nodes/edges it implicates). Used by the global Network Health pill
   *  to summarize IP-layer issues alongside link-layer ones. */
  ipv4Findings: Ipv4Finding[];
  /** Tick counter; reactive consumers bump on it to re-render. */
  tick: number;
}

export const trunkInspectorStore = $state<TrunkInspectorStore>({
  activeTrunkId: null,
  byTrunkId: new Map(),
  findingsByTrunkId: new Map(),
  ipv4Findings: [],
  tick: 0,
});

export function openTrunkInspector(trunkId: string): void {
  trunkInspectorStore.activeTrunkId = trunkId;
}

export function closeTrunkInspector(): void {
  trunkInspectorStore.activeTrunkId = null;
}

export function publishTrunkStates(states: Map<string, MstpTrunkState>): void {
  trunkInspectorStore.byTrunkId = states;
  trunkInspectorStore.tick++;
}

export function publishMstpFindings(findings: Map<string, MstpFinding[]>): void {
  trunkInspectorStore.findingsByTrunkId = findings;
}

export function publishIpv4Findings(findings: Ipv4Finding[]): void {
  trunkInspectorStore.ipv4Findings = findings;
}
