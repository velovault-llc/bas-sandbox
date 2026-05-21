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
}>({
  clear: null,
  reset: null,
  saveScenario: null,
});

/**
 * Model-pick modal coordination. When a user drops a generic Controller /
 * Sensor / Safety from the bottom dock, BuildCanvas defers final node
 * creation and sets `pending` here. App.svelte renders a modal that lets
 * the user pick a real-world catalog model (or "generic placeholder" if
 * they really want a no-model node). Picking calls back into BuildCanvas
 * via the resolver fn.
 */
export type PendingKind = 'controller' | 'sensor' | 'safety';

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
