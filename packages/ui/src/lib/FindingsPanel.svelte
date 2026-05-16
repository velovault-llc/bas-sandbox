<script lang="ts">
  import type { Severity, ValidationFinding } from '@bas/core';

  type Props = {
    findings: readonly ValidationFinding[];
    durationMs?: number | null;
  };

  let { findings, durationMs = null }: Props = $props();

  type Group = {
    ruleId: string;
    ruleName: string;
    severity: Severity;
    count: number;
    items: readonly ValidationFinding[];
  };

  const grouped = $derived.by((): Group[] => {
    const map = new Map<string, ValidationFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.ruleId);
      if (arr) arr.push(f);
      else map.set(f.ruleId, [f]);
    }
    return Array.from(map.entries())
      .map(
        ([ruleId, items]): Group => ({
          ruleId,
          ruleName: items[0].ruleName,
          severity: highestSeverity(items),
          count: items.length,
          items,
        }),
      )
      .sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity) || b.count - a.count);
  });

  const stats = $derived.by(() => {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const f of findings) {
      if (f.severity === 'error') errors++;
      else if (f.severity === 'warning') warnings++;
      else infos++;
    }
    return { errors, warnings, infos };
  });

  function highestSeverity(items: ValidationFinding[]): Severity {
    if (items.some((i) => i.severity === 'error')) return 'error';
    if (items.some((i) => i.severity === 'warning')) return 'warning';
    return 'info';
  }

  function severityOrder(s: Severity): number {
    return s === 'error' ? 3 : s === 'warning' ? 2 : 1;
  }
</script>

{#if findings.length === 0}
  <div class="empty">
    <strong>No findings.</strong> Archive passed all {durationMs !== null
      ? 'validators'
      : 'configured rules'}.
    {#if durationMs !== null}<span class="duration"> ({durationMs} ms)</span>{/if}
  </div>
{:else}
  <div class="summary">
    {#if stats.errors > 0}
      <span class="badge sev-error">{stats.errors.toLocaleString()} errors</span>
    {/if}
    {#if stats.warnings > 0}
      <span class="badge sev-warning">{stats.warnings.toLocaleString()} warnings</span>
    {/if}
    {#if stats.infos > 0}
      <span class="badge sev-info">{stats.infos.toLocaleString()} info</span>
    {/if}
    {#if durationMs !== null}
      <span class="duration">{durationMs} ms</span>
    {/if}
  </div>

  <div class="rules">
    {#each grouped as group (group.ruleId)}
      <details class="rule sev-{group.severity}">
        <summary>
          <span class="sev-dot"></span>
          <strong>{group.ruleName}</strong>
          <span class="count">{group.count.toLocaleString()}</span>
        </summary>
        <ul class="items">
          {#each group.items.slice(0, 50) as f, i (i)}
            <li>
              <span class="title">{f.title}</span>
              {#if f.description}<span class="description">{f.description}</span>{/if}
            </li>
          {/each}
          {#if group.items.length > 50}
            <li class="more">
              … and {(group.items.length - 50).toLocaleString()} more
            </li>
          {/if}
        </ul>
      </details>
    {/each}
  </div>
{/if}

<style>
  .empty {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    background: color-mix(in srgb, #2ecc71 8%, transparent);
    border-left: 3px solid #2ecc71;
    font-size: 0.9rem;
  }

  .duration {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    align-items: center;
    font-size: 0.85rem;
  }

  .badge {
    padding: 0.15rem 0.6rem;
    border-radius: 10px;
    font-variant-numeric: tabular-nums;
  }

  .sev-error {
    background: color-mix(in srgb, #e74c3c 18%, transparent);
    color: #e74c3c;
  }
  .sev-warning {
    background: color-mix(in srgb, #f39c12 18%, transparent);
    color: #f39c12;
  }
  .sev-info {
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: #4a9eff;
  }

  .rules {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .rule {
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 6px;
    overflow: hidden;
  }

  summary {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    background: color-mix(in srgb, CanvasText 4%, transparent);
  }

  .sev-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .rule.sev-error .sev-dot {
    background: #e74c3c;
  }
  .rule.sev-warning .sev-dot {
    background: #f39c12;
  }
  .rule.sev-info .sev-dot {
    background: #4a9eff;
  }

  summary strong {
    flex: 1;
    font-weight: 500;
    font-size: 0.9rem;
  }

  .count {
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-variant-numeric: tabular-nums;
    padding: 0.05rem 0.55rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 10px;
  }

  .items {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    max-height: 24rem;
    overflow-y: auto;
  }

  .items li {
    padding: 0.45rem 0.75rem 0.45rem 1.85rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 5%, transparent);
    font-size: 0.82rem;
  }

  .items li:last-child {
    border-bottom: none;
  }

  .title {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    word-break: break-all;
  }

  .description {
    display: block;
    margin-top: 0.15rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 0.78rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    word-break: break-all;
  }

  .more {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-style: italic;
  }
</style>
