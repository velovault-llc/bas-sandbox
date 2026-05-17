// Shared scenario types — extracted so demoScenarios.ts (and any future
// scenario tooling) can build BasScenarioV1 objects without circular-importing
// from BuildCanvas.svelte.

import type { Edge, Node } from '@xyflow/svelte';
import type { SingleZoneConfig } from './sim/thermal';

export type WiredTargetSpec = {
  controllerId: string;
  sensorId: string;
  config: SingleZoneConfig;
};

/**
 * On-disk shape of a saved scenario. `version: 1` is the only schema today;
 * the optional fields exist for back-compat with earlier alpha files that
 * predated multi-target wiring.
 */
export type BasScenarioV1 = {
  version: 1;
  savedAt?: string;
  topology: {
    nodes: Node[];
    edges: Edge[];
  };
  selection: { controllerId: string | null };
  config: SingleZoneConfig;
  wiredTargets?: WiredTargetSpec[];
  focusedTargetId?: string | null;
  counters: Record<string, number>;
  nextId: number;
};
