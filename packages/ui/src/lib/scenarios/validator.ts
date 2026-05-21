// Build-time scenario validator.
//
// Reads the live canvas state (nodes + edges) and a ScenarioDefinition,
// returns per-step pass/fail with reasons. The ScenarioPanel UI renders
// these as a checklist that lights up as the user builds.

import type { Node, Edge } from '@xyflow/svelte';
import {
  findControllerModel,
  findSensorModel,
  findSafetyDevice,
  type ScenarioDefinition,
  type EquipmentRequirement,
} from '@bas/core';

export interface StepResult {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  /** Human-readable reason when failed; or "Found <node>" when passed. */
  readonly detail: string;
  /** Node id we matched the step against, if any. */
  readonly matchedNodeId?: string;
}

export interface ValidationResult {
  readonly equipmentSteps: readonly StepResult[];
  readonly wireSteps: readonly StepResult[];
  /** Map of scenario tag → canvas node id, for cross-referencing wire steps. */
  readonly tagToNodeId: ReadonlyMap<string, string>;
}

export function validateScenario(
  scenario: ScenarioDefinition,
  nodes: readonly Node[],
  edges: readonly Edge[],
): ValidationResult {
  const tagToNodeId = new Map<string, string>();
  const equipmentSteps: StepResult[] = [];

  for (const req of scenario.equipment) {
    const match = findMatchingNode(req, nodes, tagToNodeId);
    if (match) {
      tagToNodeId.set(req.tag, match.id);
      const label = (match.data as { label?: string } | undefined)?.label ?? match.id;
      equipmentSteps.push({
        id: `eq-${req.tag}`,
        description: `${req.tag} — ${req.role}`,
        passed: true,
        detail: `Matched "${label}"`,
        matchedNodeId: match.id,
      });
    } else {
      equipmentSteps.push({
        id: `eq-${req.tag}`,
        description: `${req.tag} — ${req.role}`,
        passed: false,
        detail: failureReason(req),
      });
    }
  }

  const wireSteps: StepResult[] = scenario.wires.map((w) => {
    const fromId = tagToNodeId.get(w.fromTag);
    const toId = tagToNodeId.get(w.toTag);
    if (!fromId || !toId) {
      return {
        id: `wire-${w.fromTag}-${w.toTag}`,
        description: `Wire ${w.fromTag} ↔ ${w.toTag}${w.note ? ` — ${w.note}` : ''}`,
        passed: false,
        detail: !fromId ? `Place ${w.fromTag} first.` : `Place ${w.toTag} first.`,
      };
    }
    const found = edges.find(
      (e) =>
        (e.source === fromId && e.target === toId) || (e.source === toId && e.target === fromId),
    );
    if (!found) {
      return {
        id: `wire-${w.fromTag}-${w.toTag}`,
        description: `Wire ${w.fromTag} ↔ ${w.toTag}${w.note ? ` — ${w.note}` : ''}`,
        passed: false,
        detail: `Drag a wire between ${w.fromTag} and ${w.toTag}.`,
      };
    }
    const actualKind = (found.data as { wireKind?: string } | undefined)?.wireKind;
    if (actualKind && actualKind !== w.wireKind) {
      return {
        id: `wire-${w.fromTag}-${w.toTag}`,
        description: `Wire ${w.fromTag} ↔ ${w.toTag}${w.note ? ` — ${w.note}` : ''}`,
        passed: false,
        detail: `Wire kind is "${actualKind}" — expected "${w.wireKind}".`,
      };
    }
    return {
      id: `wire-${w.fromTag}-${w.toTag}`,
      description: `Wire ${w.fromTag} ↔ ${w.toTag}${w.note ? ` — ${w.note}` : ''}`,
      passed: true,
      detail: `Connected via ${actualKind ?? w.wireKind}.`,
    };
  });

  return { equipmentSteps, wireSteps, tagToNodeId };
}

function findMatchingNode(
  req: EquipmentRequirement,
  nodes: readonly Node[],
  alreadyAssigned: ReadonlyMap<string, string>,
): Node | undefined {
  const usedIds = new Set(alreadyAssigned.values());
  return nodes.find((n) => {
    if (usedIds.has(n.id)) return false;
    const data = n.data as {
      kind?: string;
      vendorModelId?: string;
      sensorModelId?: string;
      safetyModelId?: string;
    };
    if (data.kind !== req.kind) return false;

    // Exact model preferred — if it matches that's the strongest signal.
    if (req.preferredModelId) {
      if (data.vendorModelId === req.preferredModelId) return true;
      if (data.sensorModelId === req.preferredModelId) return true;
      if (data.safetyModelId === req.preferredModelId) return true;
      // Fall through to hint-based match (preferred is a recommendation,
      // not a hard requirement; the user can substitute equivalent models).
    }

    // Hint matching: sensor subject / safety kind / controller capability.
    if (req.kind === 'controller' && data.vendorModelId) {
      const m = findControllerModel(data.vendorModelId);
      if (!m) return false;
      if (req.hints?.minPoints && m.maxPoints < req.hints.minPoints) return false;
      if (req.hints?.protocols) {
        for (const p of req.hints.protocols) {
          if (!m.protocols.includes(p as never)) return false;
        }
      }
      return true;
    }
    if (req.kind === 'sensor' && data.sensorModelId) {
      const m = findSensorModel(data.sensorModelId);
      if (!m) return false;
      if (req.hints?.sensorSubject && m.subject !== req.hints.sensorSubject) return false;
      return true;
    }
    if (req.kind === 'safety' && data.safetyModelId) {
      const m = findSafetyDevice(data.safetyModelId);
      if (!m) return false;
      if (req.hints?.safetyKind && m.kind !== req.hints.safetyKind) return false;
      return true;
    }
    // Generic node with no model — accept on kind match (scenario allows
    // substitution while sketching). The wire-validation will catch
    // protocol-mismatch later.
    return !req.preferredModelId;
  });
}

function failureReason(req: EquipmentRequirement): string {
  if (req.preferredModelId) {
    return `Drop a ${req.kind} — recommended model: ${req.preferredModelId}.`;
  }
  if (req.kind === 'sensor' && req.hints?.sensorSubject) {
    return `Drop a sensor — subject: ${req.hints.sensorSubject}.`;
  }
  if (req.kind === 'safety' && req.hints?.safetyKind) {
    return `Drop a safety device — kind: ${req.hints.safetyKind}.`;
  }
  if (req.kind === 'controller') {
    const hints: string[] = [];
    if (req.hints?.minPoints) hints.push(`≥${req.hints.minPoints} points`);
    if (req.hints?.protocols?.length) hints.push(req.hints.protocols.join(' / '));
    return `Drop a controller${hints.length ? ` (${hints.join(', ')})` : ''}.`;
  }
  return `Drop a ${req.kind}.`;
}
