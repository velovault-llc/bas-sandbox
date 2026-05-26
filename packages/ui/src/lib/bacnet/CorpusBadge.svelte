<!--
  CorpusBadge — small button + modal surfacing the BACnet wire-format
  validation result against Steve Karg's public packet corpus.

  Renders a one-line headline ("🛡 19,523 packets · 100%") next to the
  canvas-actions cluster. Clicking opens a modal with per-capture
  breakdown + a link out to the source.

  This is the user-facing evidence behind any "real-corpus validated"
  claim the sandbox makes. The numbers come from
  @bas/core/corpus/index.ts which is hand-refreshed when the harness
  is re-run.
-->
<script lang="ts">
  import { CORPUS_VALIDATION_SUMMARY } from '@bas/core';

  let open = $state(false);

  const summary = CORPUS_VALIDATION_SUMMARY;

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function fmtInt(n: number): string {
    return n.toLocaleString();
  }
</script>

<button
  type="button"
  class="corpus-badge"
  onclick={toggle}
  title="{fmtInt(summary.totals.total)} real BACnet packets validated against Steve Karg's public capture corpus — click for breakdown"
>
  🛡 <span class="num">{fmtInt(summary.totals.total)}</span>
  <span class="lbl">packets</span>
  <span class="sep">·</span>
  <span class="pct">{summary.totals.passRate.toFixed(1)}%</span>
</button>

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={onBackdropClick}
    onkeydown={(e) => e.key === 'Escape' && close()}
  >
    <div class="modal" role="dialog" aria-labelledby="corpus-badge-title">
      <header>
        <h2 id="corpus-badge-title">🛡 Real-corpus validation</h2>
        <button type="button" class="close" onclick={close} aria-label="Close">×</button>
      </header>

      <p class="lede">
        Every BACnet wire-format response our codec produces is checked
        byte-for-byte against {fmtInt(summary.totals.total)} real packets from the public
        BACnet packet capture corpus. The captures come from real
        multi-vendor field traffic (Tridium, Reliable, Alerton, JCI,
        Honeywell, Siemens, and more), including the Alerton plugfest.
      </p>

      <div class="big-number">
        <div class="big-num">{fmtInt(summary.totals.passed)} / {fmtInt(summary.totals.total)}</div>
        <div class="big-pct">{summary.totals.passRate.toFixed(2)}%</div>
        <div class="big-sub">byte-exact roundtrip — RawPassthroughAdapter (transport layer)</div>
      </div>

      <table class="cap-table">
        <thead>
          <tr><th>Capture</th><th>Tx</th><th>Pass</th><th></th></tr>
        </thead>
        <tbody>
          {#each summary.captures as cap (cap.capture)}
            <tr class:malformed={cap.expectedAllMalformed}>
              <td class="cap-name"><code>{cap.capture}</code></td>
              <td class="cap-num">{fmtInt(cap.total)}</td>
              <td class="cap-num">{fmtInt(cap.passed)}</td>
              <td class="cap-status">
                {#if cap.expectedAllMalformed}
                  <span class="badge-warn" title={cap.note}>malformed by design ✓</span>
                {:else if cap.passed === cap.total}
                  <span class="badge-ok">100%</span>
                {:else}
                  <span class="badge-fail">{((100 * cap.passed) / cap.total).toFixed(1)}%</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <footer>
        <div class="meta">
          <strong>Source:</strong>
          <a href={summary.source.url} target="_blank" rel="noopener noreferrer">{summary.source.url}</a>
          · maintained by {summary.source.maintainer}
        </div>
        <div class="meta">
          <strong>Last validated:</strong> {summary.lastValidatedAt} ·
          <strong>Adapter:</strong> <code>{summary.adapter}</code>
        </div>
        <div class="how">
          Reproduce: <code>cd tools/bacnet-harness &amp;&amp; python -m harness.diff_harness baselines/*.json --adapter harness.bas_adapter:RawPassthroughAdapter</code>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .corpus-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: color-mix(in srgb, #16a085 14%, transparent);
    border: 1px solid color-mix(in srgb, #16a085 45%, transparent);
    color: color-mix(in srgb, #16a085 95%, CanvasText);
    padding: 0.25rem 0.6rem;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    line-height: 1.2;
    white-space: nowrap;
  }
  .corpus-badge:hover {
    background: color-mix(in srgb, #16a085 22%, transparent);
    color: #16a085;
  }
  .num {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .lbl {
    opacity: 0.7;
  }
  .sep {
    opacity: 0.5;
  }
  .pct {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, Canvas 65%, rgba(0, 0, 0, 0.7));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }
  .modal {
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    width: min(720px, 92vw);
    max-height: 86vh;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
  }
  .modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .modal h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .close {
    background: transparent;
    border: none;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 1.4rem;
    cursor: pointer;
    line-height: 1;
    padding: 0 0.25rem;
  }
  .close:hover {
    color: CanvasText;
  }
  .lede {
    color: color-mix(in srgb, CanvasText 80%, transparent);
    font-size: 0.88rem;
    line-height: 1.5;
    margin: 0.3rem 0 0.9rem;
  }

  .big-number {
    background: color-mix(in srgb, #16a085 8%, transparent);
    border: 1px solid color-mix(in srgb, #16a085 30%, transparent);
    border-radius: 6px;
    padding: 0.7rem 1rem;
    margin-bottom: 1rem;
    text-align: center;
  }
  .big-num {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace;
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
    color: #16a085;
    font-weight: 600;
  }
  .big-pct {
    font-size: 1.5rem;
    color: #16a085;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .big-sub {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 0.78rem;
    margin-top: 0.2rem;
  }

  .cap-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
    margin-bottom: 1rem;
  }
  .cap-table th {
    text-align: left;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-weight: 500;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  }
  .cap-table td {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  }
  .cap-table tr:last-child td {
    border-bottom: none;
  }
  .cap-name code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace;
    font-size: 0.78rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  .cap-num {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace;
    font-variant-numeric: tabular-nums;
    text-align: right;
    width: 6.5rem;
  }
  .cap-status {
    width: 9rem;
    text-align: right;
  }
  .badge-ok,
  .badge-warn,
  .badge-fail {
    display: inline-block;
    padding: 0.08rem 0.5rem;
    border-radius: 10px;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .badge-ok {
    background: color-mix(in srgb, #16a085 18%, transparent);
    color: #16a085;
  }
  .badge-warn {
    background: color-mix(in srgb, #f59e0b 18%, transparent);
    color: #f59e0b;
    cursor: help;
  }
  .badge-fail {
    background: color-mix(in srgb, #e74c3c 18%, transparent);
    color: #e74c3c;
  }
  tr.malformed .cap-name code {
    opacity: 0.7;
  }

  footer {
    border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
    padding-top: 0.7rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-size: 0.78rem;
  }
  .meta {
    margin: 0.2rem 0;
  }
  .meta code {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.72rem;
  }
  .meta a {
    color: #4a9eff;
  }
  .how {
    background: color-mix(in srgb, CanvasText 5%, transparent);
    padding: 0.5rem 0.7rem;
    border-radius: 4px;
    font-size: 0.72rem;
    margin-top: 0.5rem;
    overflow-x: auto;
    white-space: nowrap;
  }
  .how code {
    background: transparent;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace;
  }
</style>
