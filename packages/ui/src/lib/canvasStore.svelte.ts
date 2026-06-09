// Shared module-scoped state for cross-component messages on the build canvas.

import type { Edge, Node } from '@xyflow/svelte';

export const importStore = $state<{
  pending: { nodes: Node[]; edges: Edge[]; sourceLabel: string } | null;
}>({
  pending: null,
});

/**
 * Top-bar hooks. BuildCanvas registers its Clear / Reset / Save fns here
 * on mount so App.svelte's header can expose one-click buttons without
 * lifting state. Null = canvas not mounted yet (header buttons disabled).
 */
export const canvasActions = $state<{
  clear: (() => void) | null;
  reset: (() => void) | null;
  saveScenario: (() => void) | null;
  addSubnetZone: (() => void) | null;
}>({
  clear: null,
  reset: null,
  saveScenario: null,
  addSubnetZone: null,
});

/**
 * Model-pick modal coordination. When a user drops a generic Controller /
 * Sensor / Safety from the bottom dock, BuildCanvas defers final node
 * creation and sets `pending` here. App.svelte renders a modal that lets
 * the user pick a real-world catalog model (or "generic placeholder" if
 * they really want a no-model node). Picking calls back into BuildCanvas
 * via the resolver fn.
 */
export type PendingKind = 'controller' | 'sensor' | 'safety' | 'supervisor' | 'actuator';

export const modelPickerStore = $state<{
  pending: {
    kind: PendingKind;
    /** Called once the user has chosen. `modelId` is null when the user
     *  explicitly picks "generic placeholder". */
    resolve: (modelId: string | null) => void;
    /** Called if the user cancels the pick (Esc / close button). */
    cancel: () => void;
  } | null;
}>({
  pending: null,
});

export function openModelPicker(
  kind: PendingKind,
  resolve: (modelId: string | null) => void,
  cancel: () => void,
): void {
  modelPickerStore.pending = { kind, resolve, cancel };
}

export function closeModelPicker(): void {
  modelPickerStore.pending = null;
}

/**
 * Selection broadcast — BuildCanvas writes the currently-selected
 * controller's vendor here so the Devices drawer can grey out
 * incompatible expansion modules. Null when no controller is selected
 * (or a non-controller node is).
 */
export const selectionStore = $state<{
  selectedControllerVendor: string | null;
}>({
  selectedControllerVendor: null,
});

/**
 * Snapshot broadcast — BuildCanvas writes its current nodes + edges here
 * so other panels (the scenario walkthrough, future analytics) can read
 * canvas state without prop-drilling through the component tree. Updated
 * via $effect inside BuildCanvas any time nodes / edges change.
 */
export const canvasSnapshot = $state<{
  nodes: Node[];
  edges: Edge[];
}>({
  nodes: [],
  edges: [],
});

/**
 * "Show me" — when the scenario walkthrough wants to point the user at a
 * specific model in the Devices drawer, it writes the request here. The
 * App + DevicesPalette pick it up and open the drawer to the right tab.
 */
export const devicesNavStore = $state<{
  /** Bumped each time a "show me" is requested so palette can react. */
  pulse: number;
  /** Sub-tab to switch to. */
  tab: 'controllers' | 'sensors' | 'safeties' | 'expansions' | null;
  /** Model id to highlight + scroll-to. */
  modelId: string | null;
}>({
  pulse: 0,
  tab: null,
  modelId: null,
});

export function showInDevices(
  tab: 'controllers' | 'sensors' | 'safeties' | 'expansions',
  modelId: string,
): void {
  devicesNavStore.tab = tab;
  devicesNavStore.modelId = modelId;
  devicesNavStore.pulse++;
}
