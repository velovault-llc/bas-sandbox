// Guided-scenario type definitions.
//
// A Scenario walks a user through building + programming a real-world BAS
// install — single-zone AHU, VAV with reheat, boiler + hot-water loop,
// etc. The structure is deliberately data-driven so adding scenarios is
// a JSON-ish exercise, not a code change.
//
// Validation happens in two passes:
//   - Build-time: equipment present? wires connected? signal types match?
//   - Run-time: under test conditions, do outputs respond correctly?
//
// The walkthrough UI reads from this structure, surfaces each step as a
// checklist row, and auto-checks rows when the canvas state satisfies the
// step's predicate.

import type { WireKind } from './wire-kind.js';

export type ScenarioDifficulty = 'apprentice' | 'tech' | 'commissioning-agent';

export interface ScenarioDefinition {
  readonly id: string;
  readonly title: string;
  /** Short marketing-grade hook for the scenario picker. */
  readonly tagline: string;
  /** Difficulty tier. Apprentice = textbook with strong hints; commissioning-
   *  agent = field-realistic with minimal hand-holding. */
  readonly difficulty: ScenarioDifficulty;
  /** Real-world context paragraph the user reads first. */
  readonly context: string;
  /** Roughly how long this should take a competent tech. */
  readonly estimatedMinutes: number;
  /** ASHRAE / industry-standard reference (e.g. "ASHRAE G36 §5.2.1"). */
  readonly reference?: string;

  readonly equipment: readonly EquipmentRequirement[];
  readonly wires: readonly WireRequirement[];
  readonly program: ProgramSpec;
  readonly runtimeChecks: readonly RuntimeCheck[];
}

/** A single piece of equipment the user must place. */
export interface EquipmentRequirement {
  /** Tag the rest of the spec references this device by. e.g. "AHU-1" or "MA-T". */
  readonly tag: string;
  /** Human-readable role: "Supply fan controller", "Mixed-air temp sensor". */
  readonly role: string;
  /** Preferred vendor catalog id when the scenario calls for an exact match.
   *  null = any compatible model is fine. */
  readonly preferredModelId: string | null;
  /** Kind for type-checking the drop. */
  readonly kind: 'supervisor' | 'controller' | 'sensor' | 'safety' | 'expansion';
  /** When `preferredModelId` is null, the scenario validator falls back to
   *  these filter hints to find a satisfying device. */
  readonly hints?: {
    /** Acceptable sensor subjects ('temp', 'co2', 'humidity', 'pressure-static', ...). */
    readonly sensorSubject?: string;
    /** Acceptable safety kinds ('freezestat', 'duct-smoke', ...). */
    readonly safetyKind?: string;
    /** Minimum points the controller must have. */
    readonly minPoints?: number;
    /** Required protocols. */
    readonly protocols?: readonly string[];
  };
  /** A short explanation: "We need a duct-mount Pt1000 for the mixed-air plenum." */
  readonly rationale: string;
}

/** A required wire between two equipment tags. */
export interface WireRequirement {
  readonly fromTag: string;
  readonly toTag: string;
  readonly wireKind: WireKind;
  /** Notes on this specific connection. */
  readonly note?: string;
}

/** Programming-language spec for the controller. */
export interface ProgramSpec {
  /** Block-diagram (FBD) or text-source (ST). */
  readonly language: 'fbd' | 'st';
  /** Plain-English sequence description, G36-style. */
  readonly sequence: readonly string[];
  /** When language = 'fbd', list of block types the user is expected to use. */
  readonly requiredBlocks?: readonly string[];
  /** Optional starter graph the user can load if they want to skip ahead. */
  readonly starterGraph?: unknown; // FbdGraph
}

/** A run-time check applied after the user clicks Run.
 *  The validator drives the sim into specific conditions and verifies
 *  the controller's output response. */
export interface RuntimeCheck {
  readonly id: string;
  /** Human description: "Discharge-air temp tracks setpoint when load is moderate." */
  readonly description: string;
  /** Sim inputs to set before running. */
  readonly inputs: Readonly<Record<string, number>>;
  /** Expected output ranges after settling. */
  readonly expects: readonly {
    readonly output: string;
    readonly min?: number;
    readonly max?: number;
    readonly approx?: number;
    readonly tolerance?: number;
  }[];
}
