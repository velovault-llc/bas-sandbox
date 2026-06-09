// Guidance mode — shared across the canvas and the inspector panels.
//
//   'easy'      — training wheels: incompatible wiring is blocked, and the
//                 sandbox surfaces omniscient hints a real controller could
//                 never give you (e.g. "the installed sensor is Pt1000 but this
//                 terminal is programmed Ni1000 — mismatch").
//   'realistic' — the field: bad wiring is allowed silently, and the panels
//                 show only what the controller actually knows. A real
//                 controller can't tell what element is wired to it — it reads
//                 ohms and applies its configured curve — so the omniscient
//                 hints are withheld. A wrong reading is your only tell.
//
// Lives in its own store (not BuildCanvas-local) so the Terminals inspector can
// gate its "installed vs programmed" view on the mode without prop-drilling.

export type GuidanceMode = 'easy' | 'realistic';

const STORAGE_KEY = 'bas-sandbox.guidance-mode';

function loadInitial(): GuidanceMode {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'realistic') {
    return 'realistic';
  }
  return 'easy';
}

export const guidanceStore = $state<{ mode: GuidanceMode }>({ mode: loadInitial() });

export function setGuidanceMode(mode: GuidanceMode): void {
  guidanceStore.mode = mode;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, mode);
  }
}
