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
const LS_POSITION = 'bas-sandbox.runtime-log.position';

interface RuntimeLogStore {
  entries: LogEntry[];
  panelOpen: boolean;
  /** Level filter — show entries at this level or higher severity. */
  filter: LogLevel | 'all';
  paused: boolean;
  /** Offset from the bottom-right of canvas-area (pixels). User-draggable. */
  offsetX: number;
  offsetY: number;
}

function loadStoredPosition(): { x: number; y: number } {
  if (typeof localStorage === 'undefined') return { x: 0, y: 0 };
  try {
    const raw = localStorage.getItem(LS_POSITION);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as { x: number; y: number };
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
  } catch {
    // ignore
  }
  return { x: 0, y: 0 };
}

const _initialPos = loadStoredPosition();

export const runtimeLog = $state<RuntimeLogStore>({
  entries: [],
  panelOpen: true,
  filter: 'all',
  paused: false,
  offsetX: _initialPos.x,
  offsetY: _initialPos.y,
});

/** Headroom (px) to keep the drag-handle inside the viewport. Anything
 *  larger than (viewportHeight - this) would push the header above the
 *  top of the screen and the panel becomes un-draggable. */
const PANEL_MIN_HEADER_VISIBLE = 80;

export function setPanelPosition(x: number, y: number): void {
  const { cx, cy } = clampToViewport(x, y);
  runtimeLog.offsetX = cx;
  runtimeLog.offsetY = cy;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_POSITION, JSON.stringify({ x: cx, y: cy }));
  } catch {
    // ignore
  }
}

/** Snap the panel back to the default bottom-right corner. Wired to a
 *  button in the header so a stuck panel is always recoverable. */
export function resetPanelPosition(): void {
  setPanelPosition(0, 0);
}

/** Clamp x/y so the panel's header stays clickable on the current
 *  viewport. Bottom-right anchored coords: bigger Y = further from
 *  bottom = closer to top. */
function clampToViewport(x: number, y: number): { cx: number; cy: number } {
  if (typeof window === 'undefined') return { cx: Math.max(0, x), cy: Math.max(0, y) };
  const maxY = Math.max(0, window.innerHeight - PANEL_MIN_HEADER_VISIBLE);
  const maxX = Math.max(0, window.innerWidth - PANEL_MIN_HEADER_VISIBLE);
  return {
    cx: Math.min(maxX, Math.max(0, x)),
    cy: Math.min(maxY, Math.max(0, y)),
  };
}

/** Re-clamp the stored position to the current viewport. Call this on
 *  app mount + on window resize so a saved-from-different-screen
 *  position can't strand the panel off-screen. */
export function rehydratePanelPosition(): void {
  const { cx, cy } = clampToViewport(runtimeLog.offsetX, runtimeLog.offsetY);
  if (cx !== runtimeLog.offsetX || cy !== runtimeLog.offsetY) {
    setPanelPosition(cx, cy);
  }
}

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
