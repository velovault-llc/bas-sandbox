// Bridge between the CLI panel and BuildCanvas's controller config.
//
// BuildCanvas owns the per-controller config + last-tick snapshot. The CLI
// runs in App.svelte / CLIPanel and needs to (a) read snapshot for `show
// points`, (b) mutate config for `set setpoint 72`. Rather than couple the
// two with a deep prop chain, BuildCanvas writes its current bridge here
// and the CLI reads it.

import type { ControllerProgram } from './programStore.svelte';

export interface ControllerSnapshot {
  sensed: number;
  setpoint: number;
  oat: number;
  actuator: number;
  mode: 'cool' | 'heat';
  Kp: number;
  Ki: number;
  /** Vendor model id from VENDOR_CATALOG when the user dragged from the
   *  catalog drawer; null/undefined for generic controllers. */
  vendorModelId?: string;
}

export interface ControllerBridge {
  /** Return the latest sim snapshot for the named controller. */
  getSnapshot(controllerId: string): ControllerSnapshot | null;
  /** Apply a config change. Returns null on success, error message otherwise. */
  setConfig(
    controllerId: string,
    key: 'setpoint' | 'Kp' | 'Ki' | 'mode',
    value: number | string,
  ): string | null;
}

interface BridgeState {
  impl: ControllerBridge | null;
  /** Bump on each tick so reactive consumers (the CLI panel) can re-render. */
  tick: number;
  /** Hook BuildCanvas uses to apply each controller's ST program after PI. */
  runStPrograms?: (snapshots: Map<string, ControllerSnapshot>) => void;
  /** Map of controller programs the canvas should run each tick. */
  programs: Map<string, ControllerProgram>;
}

export const controllerBridge = $state<BridgeState>({
  impl: null,
  tick: 0,
  programs: new Map(),
});

export function registerBridge(impl: ControllerBridge): void {
  controllerBridge.impl = impl;
}

export function bumpTick(): void {
  controllerBridge.tick++;
}
