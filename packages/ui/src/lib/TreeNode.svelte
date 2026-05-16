<script lang="ts">
  import type { TopologyNode } from '@bas/core';
  import TreeNode from './TreeNode.svelte';

  type Props = {
    node: TopologyNode;
    depth?: number;
  };

  let { node, depth = 0 }: Props = $props();

  let expanded = $state(false);
  const hasChildren = $derived(node.children.length > 0);

  function toggle() {
    if (hasChildren) expanded = !expanded;
  }

  function kindIcon(kind: string): string {
    switch (kind) {
      case 'engine':
        return '◉';
      case 'fieldbus':
      case 'n2trunk':
      case 'bacnettrunk':
      case 'lontrunk':
        return '⌬';
      case 'programming':
      case 'sysprograms':
      case 'logic':
        return 'λ';
      case 'schedules':
      case 'schedule':
        return '▣';
      case 'graphics':
      case 'graphic':
        return '◐';
      case 'site':
      case 'generic':
        return '◇';
      case 'folder':
      case 'category':
        return '▸';
      case 'equipment':
        return '▢';
      case 'point':
        return '·';
      case 'trendlog':
        return '≈';
      case 'alarm':
        return '⚠';
      default:
        return '·';
    }
  }
</script>

<div class="tree-node" style:--depth={depth}>
  <div class="row" class:has-children={hasChildren}>
    <button
      type="button"
      class="toggle"
      class:has-children={hasChildren}
      onclick={toggle}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-label={hasChildren ? (expanded ? 'Collapse' : 'Expand') : node.label}
    >
      {#if hasChildren}{expanded ? '▼' : '▶'}{/if}
    </button>
    <span class="icon kind-{node.kind}" title={node.kind}>{kindIcon(node.kind)}</span>
    <span class="label" title={node.label}>{node.label}</span>
    {#if hasChildren}
      <span class="count" title={`${node.objectCount} objects`}>
        {node.objectCount.toLocaleString()}
      </span>
    {/if}
  </div>

  {#if expanded}
    <div class="children">
      {#each node.children as child (child.id)}
        <TreeNode node={child} depth={depth + 1} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node {
    --indent-step: 1rem;
  }

  .row {
    display: grid;
    grid-template-columns: 1.25rem 1.5rem 1fr auto;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.35rem;
    padding-left: calc(var(--depth, 0) * var(--indent-step) + 0.35rem);
    border-radius: 3px;
  }

  .row.has-children:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .toggle {
    border: none;
    background: none;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    cursor: pointer;
    font-size: 0.55rem;
    padding: 0;
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    font: inherit;
  }

  .toggle:not(.has-children) {
    cursor: default;
    visibility: hidden;
  }

  .toggle.has-children {
    font-size: 0.6rem;
  }

  .icon {
    font-size: 0.95rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    text-align: center;
    line-height: 1;
  }

  .kind-engine {
    color: #4a9eff;
  }
  .kind-fieldbus,
  .kind-n2trunk,
  .kind-bacnettrunk,
  .kind-lontrunk {
    color: #9c8cff;
  }
  .kind-schedules,
  .kind-schedule {
    color: #fb923c;
  }
  .kind-alarm {
    color: #e74c3c;
  }
  .kind-graphics,
  .kind-graphic {
    color: #2ecc71;
  }
  .kind-programming,
  .kind-sysprograms,
  .kind-logic {
    color: #f39c12;
  }
  .kind-equipment {
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }
  .kind-point {
    color: color-mix(in srgb, CanvasText 50%, transparent);
  }

  .label {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-variant-numeric: tabular-nums;
    padding: 0.05rem 0.45rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 10px;
  }
</style>
