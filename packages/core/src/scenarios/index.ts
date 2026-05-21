// @bas/core/scenarios — guided BAS-tech training scenarios.

import type { ScenarioDefinition } from './types.js';
import { AHU_ECONOMIZER } from './ahu-economizer.js';
import { VAV_REHEAT } from './vav-reheat.js';

export type {
  ScenarioDefinition,
  EquipmentRequirement,
  WireRequirement,
  ProgramSpec,
  RuntimeCheck,
  ScenarioDifficulty,
} from './types.js';
export type { WireKind } from './wire-kind.js';

/** All shipping scenarios, ordered by intended progression difficulty.
 *  Apprentice → Tech → Commissioning Agent. */
export const SCENARIO_LIBRARY: readonly ScenarioDefinition[] = [VAV_REHEAT, AHU_ECONOMIZER];

export function findScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIO_LIBRARY.find((s) => s.id === id);
}
