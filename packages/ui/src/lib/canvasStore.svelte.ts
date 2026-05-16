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
