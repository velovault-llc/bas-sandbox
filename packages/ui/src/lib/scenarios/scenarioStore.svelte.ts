// Active-scenario state.
//
// Activated when the user picks a scenario from the Scenarios drawer.
// Walkthrough panel + validator both read from here.

import type { ScenarioDefinition } from '@bas/core';

interface ScenarioStore {
  active: ScenarioDefinition | null;
  /** Walkthrough panel collapsed-to-rail vs full. */
  collapsed: boolean;
}

export const scenarioStore = $state<ScenarioStore>({
  active: null,
  collapsed: false,
});

export function startScenario(scenario: ScenarioDefinition): void {
  scenarioStore.active = scenario;
  scenarioStore.collapsed = false;
}

export function stopScenario(): void {
  scenarioStore.active = null;
}

export function toggleScenarioCollapsed(): void {
  scenarioStore.collapsed = !scenarioStore.collapsed;
}
