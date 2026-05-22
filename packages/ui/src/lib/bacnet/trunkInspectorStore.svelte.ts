// Trunk Inspector store — tracks which MS/TP edge (if any) the user has
// opened the trunk inspector against. BuildCanvas writes the latest
// MstpTrunkState here each tick so the inspector renders live data.

import type { MstpTrunkState } from '@bas/core';

interface TrunkInspectorStore {
  /** Representative-edge-id of the trunk currently being inspected, or null. */
  activeTrunkId: string | null;
  /** Latest snapshot of every trunk's MS/TP state. Mirrors BuildCanvas's
   *  `mstpTrunkStates` Map, written each tick. The inspector reads this
   *  rather than reaching into BuildCanvas internals. */
  byTrunkId: Map<string, MstpTrunkState>;
  /** Tick counter; reactive consumers bump on it to re-render. */
  tick: number;
}

export const trunkInspectorStore = $state<TrunkInspectorStore>({
  activeTrunkId: null,
  byTrunkId: new Map(),
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
