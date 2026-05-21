// Shared module-scoped state for cross-component messages on the build canvas.
//
// Right now this just carries a "pending import" — a topology computed by App
// (e.g. when the user clicks "Open in Build" on a parsed .dbexport) that
// BuildCanvas should swap onto the canvas the next time it runs an effect.

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
