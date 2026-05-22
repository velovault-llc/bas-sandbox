// Tile catalog — the palette of phrases users assemble into rules.
//
// Each tile has a canonical token (compiler-facing) + a display label
// (user-facing). The grammar in compile.ts decides which tiles can
// follow which to form a well-formed rule.

import type { TileTemplate, TileKind } from './types.js';

/** All tiles available in the palette, grouped by kind. The UI renders
 *  these as a categorized palette; the compiler resolves token IDs back
 *  to env keys / ST operators. */
export const TILE_CATALOG: readonly TileTemplate[] = [
  // ── TRIGGERS ──────────────────────────────────────────────────────────
  { kind: 'trigger', token: 'when',  display: 'When',  description: 'Start a rule — fires whenever the condition becomes true.' },
  { kind: 'trigger', token: 'while', display: 'While', description: 'Start a rule — applies continuously as long as the condition holds.' },

  // ── ACTIONS ───────────────────────────────────────────────────────────
  { kind: 'action', token: 'open',     display: 'Open',     description: 'Drive an actuator to a specific position (0-100%).' },
  { kind: 'action', token: 'close',    display: 'Close',    description: 'Drive an actuator to a specific position (0-100%).' },
  { kind: 'action', token: 'modulate', display: 'Modulate', description: 'PID-control an actuator to maintain a setpoint.' },
  { kind: 'action', token: 'set',      display: 'Set',      description: 'Assign a value to a setpoint or variable.' },
  { kind: 'action', token: 'shutdown', display: 'Shut down', description: 'Force an actuator to zero / off — overrides everything below.' },

  // ── SUBJECTS (inputs the controller can read) ────────────────────────
  { kind: 'subject', token: 'zone-temp',         display: 'zone temp',         description: 'Zone temperature sensor reading (°F).',          envKey: 'sensed' },
  { kind: 'subject', token: 'oa-temp',           display: 'OA temp',           description: 'Outside air temperature (°F).',                  envKey: 'oat' },
  { kind: 'subject', token: 'occupancy',         display: 'occupancy',         description: 'Occupancy sensor (0 = vacant, 1 = occupied).',   envKey: 'occ' },
  { kind: 'subject', token: 'damper-position',   display: 'damper position',   description: 'Damper feedback (0-100%).',                      envKey: 'damper' },
  { kind: 'subject', token: 'cooling-setpoint',  display: 'cooling setpoint',  description: 'Active cooling setpoint (°F) — internal config from the TUNE panel, not a physical input.', envKey: 'setpoint',   internal: true },
  { kind: 'subject', token: 'heating-setpoint',  display: 'heating setpoint',  description: 'Active heating setpoint (°F) — internal config from the TUNE panel, not a physical input.', envKey: 'heating_sp', internal: true },
  { kind: 'subject', token: 'co2',               display: 'CO2',               description: 'Zone CO2 concentration (ppm).',                  envKey: 'co2' },
  { kind: 'subject', token: 'humidity',          display: 'humidity',          description: 'Zone relative humidity (% RH).',                 envKey: 'rh' },
  { kind: 'subject', token: 'airflow',           display: 'airflow',           description: 'Supply airflow (CFM).',                          envKey: 'cfm' },
  // Plant-loop sensors — read from boiler / chiller / cooling-tower
  // equipment via an immersion-temp sensor wired to the equipment.
  { kind: 'subject', token: 'hw-supply-temp',    display: 'HW supply temp',    description: 'Hot-water supply temp leaving the boiler (°F).',                envKey: 'hws_temp' },
  { kind: 'subject', token: 'hw-return-temp',    display: 'HW return temp',    description: 'Hot-water return temp coming back to the boiler (°F).',         envKey: 'hwr_temp' },
  { kind: 'subject', token: 'chw-supply-temp',   display: 'CHW supply temp',   description: 'Chilled-water supply temp leaving the chiller (°F).',           envKey: 'chws_temp' },
  { kind: 'subject', token: 'chw-return-temp',   display: 'CHW return temp',   description: 'Chilled-water return temp coming back to the chiller (°F).',    envKey: 'chwr_temp' },

  // ── ACTUATORS (outputs the controller can drive) ─────────────────────
  // Terminal-unit actuators (VAV / FCU / RTU)
  { kind: 'actuator', token: 'primary-damper', display: 'primary damper', description: 'Main air damper — primary cooling actuator (terminal unit).', envKey: 'actuator' },
  { kind: 'actuator', token: 'reheat-valve',   display: 'reheat valve',   description: 'Hot-water reheat valve (2-way or 3-way).',                    envKey: 'reheat' },
  { kind: 'actuator', token: 'cooling-valve',  display: 'cooling valve',  description: 'Chilled-water cooling valve.',                                envKey: 'cool_valve' },
  { kind: 'actuator', token: 'supply-fan',     display: 'supply fan',     description: 'Supply air fan start/stop (binary or VFD).',                  envKey: 'fan' },
  // AHU-level actuators
  { kind: 'actuator', token: 'oa-damper',      display: 'OA damper',      description: 'Outside-air / mixed-air damper actuator.',                    envKey: 'oa_damper' },
  { kind: 'actuator', token: 'return-fan',     display: 'return fan',     description: 'Return air fan VFD.',                                         envKey: 'return_fan' },
  // Plant-side actuators (HW / CHW)
  { kind: 'actuator', token: 'burner-mod',     display: 'burner modulation', description: 'Boiler burner firing-rate command (0-100%).',             envKey: 'fire_rate' },
  { kind: 'actuator', token: 'circulator-pump', display: 'circulator pump',  description: 'Primary loop pump VFD speed reference.',                  envKey: 'circ_pump' },
  { kind: 'actuator', token: 'chiller-enable', display: 'chiller enable',  description: 'Chiller plant enable (binary) — onboard staging takes over.', envKey: 'chiller_enable' },
  { kind: 'actuator', token: 'chiller-stage',  display: 'chiller stage',   description: 'Chiller capacity / staging command (0-100%).',              envKey: 'chiller_stage' },
  { kind: 'actuator', token: 'tower-fan',      display: 'tower fan',       description: 'Cooling-tower fan VFD speed reference.',                    envKey: 'tower_fan' },

  // ── OPERATORS ─────────────────────────────────────────────────────────
  { kind: 'operator', token: 'exceeds',  display: 'exceeds',  description: 'Greater than (>).' },
  { kind: 'operator', token: 'is-below', display: 'is below', description: 'Less than (<).' },
  { kind: 'operator', token: 'equals',   display: 'equals',   description: 'Equal to (=).' },
  { kind: 'operator', token: 'is',       display: 'is',       description: 'Equal to (=) — paired with a literal like "occupied".' },
  { kind: 'operator', token: 'by',       display: 'by',       description: 'Offset modifier — eg "exceeds setpoint BY 1°F".' },
  { kind: 'operator', token: 'to',       display: 'to',       description: 'Target value — eg "open damper TO 100%".' },
  { kind: 'operator', token: 'at',       display: 'at',       description: 'Maintain at — eg "modulate to maintain zone AT setpoint".' },
  { kind: 'operator', token: 'maintain', display: 'to maintain', description: 'Modulate target — eg "modulate valve TO MAINTAIN zone at setpoint".' },

  // ── VALUES (templates — actual numeric is per-instance) ───────────────
  { kind: 'value', token: 'temp-value',    display: '0 °F',  description: 'A temperature value.',           defaultNumeric: 72, defaultUnits: '°F' },
  { kind: 'value', token: 'percent-value', display: '0 %',   description: 'A percent value (0-100).',       defaultNumeric: 100, defaultUnits: '%' },
  { kind: 'value', token: 'ppm-value',     display: '0 ppm', description: 'A concentration (ppm).',        defaultNumeric: 1000, defaultUnits: 'ppm' },
  { kind: 'value', token: 'delta-value',   display: '0 Δ',   description: 'A small offset/delta.',         defaultNumeric: 1, defaultUnits: '°F' },

  // ── LITERALS (named constants) ────────────────────────────────────────
  { kind: 'literal', token: 'occupied', display: 'occupied', description: 'Occupancy = 1.' },
  { kind: 'literal', token: 'vacant',   display: 'vacant',   description: 'Occupancy = 0.' },
];

/** Tiles grouped by category for the palette UI. */
export function tileCatalogByKind(): Map<TileKind, TileTemplate[]> {
  const map = new Map<TileKind, TileTemplate[]>();
  for (const t of TILE_CATALOG) {
    const arr = map.get(t.kind) ?? [];
    arr.push(t);
    map.set(t.kind, arr);
  }
  return map;
}

/** Look up a tile template by canonical token. */
export function findTileTemplate(token: string): TileTemplate | undefined {
  return TILE_CATALOG.find((t) => t.token === token);
}
