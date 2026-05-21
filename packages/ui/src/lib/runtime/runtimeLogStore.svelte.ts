// Runtime log — streaming Wireshark-style event console for the sim.
//
// The sim writes events here as state transitions occur (cooling
// engaged, freezestat tripped, sensor open-circuit, NC/NO mismatch).
// The runtime log panel reads + renders. Bounded buffer to avoid
// runaway memory on long runs.

export type LogLevel = 'info' | 'warn' | 'error' | 'critical';

export interface LogEntry {
  readonly id: number;
  /** Sim time in seconds (NOT wall clock). */
  readonly simSec: number;
  readonly level: LogLevel;
  /** Source — typically the controller / sensor / safety node label. */
  readonly source: string;
  readonly message: string;
  /** Optional structured detail for filtering (e.g. nodeId). */
  readonly nodeId?: string;
}

const MAX_ENTRIES = 500;

interface RuntimeLogStore {
  entries: LogEntry[];
  panelOpen: boolean;
  /** Level filter — show entries at this level or higher severity. */
  filter: LogLevel | 'all';
  paused: boolean;
}

export const runtimeLog = $state<RuntimeLogStore>({
  entries: [],
  panelOpen: true,
  filter: 'all',
  paused: false,
});

let nextId = 1;

export function log(
  simSec: number,
  level: LogLevel,
  source: string,
  message: string,
  nodeId?: string,
): void {
  if (runtimeLog.paused) return;
  runtimeLog.entries.push({
    id: nextId++,
    simSec,
    level,
    source,
    message,
    nodeId,
  });
  // Trim to bound: drop oldest entries above MAX
  if (runtimeLog.entries.length > MAX_ENTRIES) {
    runtimeLog.entries = runtimeLog.entries.slice(-MAX_ENTRIES);
  }
}

export function clearLog(): void {
  runtimeLog.entries = [];
}

export function togglePanel(): void {
  runtimeLog.panelOpen = !runtimeLog.panelOpen;
}

export function togglePaused(): void {
  runtimeLog.paused = !runtimeLog.paused;
}

export function setFilter(f: LogLevel | 'all'): void {
  runtimeLog.filter = f;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

/** Entries that should render after applying the active filter. */
export function visibleEntries(): LogEntry[] {
  if (runtimeLog.filter === 'all') return runtimeLog.entries;
  const min = LEVEL_RANK[runtimeLog.filter];
  return runtimeLog.entries.filter((e) => LEVEL_RANK[e.level] >= min);
}
