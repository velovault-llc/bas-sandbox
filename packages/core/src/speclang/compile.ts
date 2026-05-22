// SpecLang compiler — tiles → Structured Text.
//
// Each SpecRule is a tile sequence with a TRIGGER clause and an ACTION
// clause separated by an arrow (implicit — the compiler scans for the
// first ACTION tile to split the rule).
//
// A rule compiles to ONE IF/THEN statement against the ST interpreter's
// env. Rules in a SpecProgram are emitted in order — later rules can
// override earlier writes to the same actuator (last-write-wins).
//
// This is intentionally simple. SpecLang v1 covers ~5 rule shapes:
//
//   When SUBJECT OPERATOR SUBJECT (by VALUE)?           → ACTION ACTUATOR to VALUE
//   When SUBJECT OPERATOR VALUE                          → ACTION ACTUATOR to VALUE
//   When SUBJECT is LITERAL                              → ACTION ACTUATOR to VALUE
//   While SUBJECT OPERATOR SUBJECT                       → Modulate ACTUATOR to maintain SUBJECT at SUBJECT
//   When SUBJECT OPERATOR VALUE                          → Shut down ACTUATOR
//
// Anything fancier (timers, schedules, multi-condition AND/OR) is v2.

import type { ControllerBindings, SpecProgram, SpecRule, Tile } from './types.js';
import { findTileTemplate } from './tiles.js';

export interface CompileResult {
  readonly ok: boolean;
  /** Compiled ST source. Empty string when ok = false. */
  readonly source: string;
  /** Per-rule error messages (rule.id → message). */
  readonly errors: ReadonlyMap<string, string>;
  /** Per-rule warnings (rule.id → message). Rules with warnings still
   *  compile — these are advisory, e.g. "this rule references 'zone temp'
   *  but no sensor is bound to that role yet." */
  readonly warnings: ReadonlyMap<string, string[]>;
  /** Lines emitted per rule (rule.id → ST line). Useful for the UI's
   *  "show as code" toggle that highlights which rule made which line. */
  readonly byRule: ReadonlyMap<string, string>;
}

export function compileSpecLang(program: SpecProgram, bindings?: ControllerBindings): CompileResult {
  const errors = new Map<string, string>();
  const warnings = new Map<string, string[]>();
  const byRule = new Map<string, string>();
  const lines: string[] = [];

  // Build a set of bound role tokens so we can warn when a rule references
  // a role that has no physical point assigned. Skip the check entirely if
  // no bindings were provided — backwards-compat with callers that don't
  // care about the point-list discipline yet.
  const boundRoles = bindings
    ? new Set(bindings.bindings.map((b) => b.role))
    : null;

  if (program.rules.length === 0) {
    return { ok: true, source: '', errors, warnings, byRule };
  }

  // Header comment so users opening "show as code" see this is SpecLang-generated.
  lines.push('(* Compiled from SpecLang — edit the tile rules to regenerate. *)');
  lines.push('');

  for (const rule of program.rules) {
    const result = compileRule(rule);
    const ruleWarnings: string[] = [];
    if (result.error) {
      errors.set(rule.id, result.error);
      lines.push(`(* rule ${rule.id}: ${result.error} *)`);
      byRule.set(rule.id, '');
    } else {
      lines.push(result.source);
      byRule.set(rule.id, result.source);
    }
    // Carry forward "monstrosity" warnings from the rule compiler (sensor
    // overrides, extreme values, extra tiles ignored, etc.)
    if (result.warnings) ruleWarnings.push(...result.warnings);
    // Point-binding warnings: collect any subject/actuator tile referenced
    // by this rule whose role isn't bound to a physical terminal.
    if (boundRoles) {
      const unbound: string[] = [];
      for (const t of rule.tiles) {
        if (t.kind === 'subject' || t.kind === 'actuator') {
          if (!boundRoles.has(t.token)) {
            unbound.push(t.display);
          }
        }
      }
      if (unbound.length > 0) {
        const uniqueUnbound = Array.from(new Set(unbound));
        ruleWarnings.push(
          `No physical point bound to: ${uniqueUnbound.join(', ')}. Assign a sensor/actuator in the Point Assignments panel before deploying.`,
        );
      }
    }
    if (ruleWarnings.length > 0) warnings.set(rule.id, ruleWarnings);
    lines.push('');
  }

  return {
    ok: errors.size === 0,
    source: lines.join('\n').trimEnd() + '\n',
    errors,
    warnings,
    byRule,
  };
}

interface RuleCompileResult {
  source: string;
  error?: string;
  /** Soft advisories that don't block compile. Things like "trigger has
   *  no condition — fires every tick" or "Set on a sensor overrides the
   *  reading in sim; real hardware would no-op." */
  warnings?: string[];
}

function compileRule(rule: SpecRule): RuleCompileResult {
  if (rule.tiles.length === 0) {
    return { source: '', error: 'Empty rule.' };
  }

  // Split tiles into trigger clause + action clause at the first ACTION tile.
  const actionIdx = rule.tiles.findIndex((t) => t.kind === 'action');
  if (actionIdx === -1) {
    return {
      source: '',
      error: 'Rule has no action — add an action tile like "Open", "Close", "Set", or "Modulate" to specify what should happen.',
    };
  }
  if (actionIdx === 0) {
    return { source: '', error: 'Rule starts with an action — add a trigger like "When" first.' };
  }

  const triggerTiles = rule.tiles.slice(0, actionIdx);
  const actionTiles = rule.tiles.slice(actionIdx);

  // ─── Compile trigger ────────────────────────────────────────────────
  const condResult = compileTrigger(triggerTiles);
  if (condResult.error) return { source: '', error: condResult.error };

  // ─── Compile action ─────────────────────────────────────────────────
  const actResult = compileAction(actionTiles);
  if (actResult.error) return { source: '', error: actResult.error };

  // Collect any soft warnings from both halves.
  const warnings: string[] = [];
  if (condResult.warning) warnings.push(condResult.warning);
  if (actResult.warning) warnings.push(actResult.warning);

  // Emit IF/THEN. For "While" triggers we wrap exactly the same way —
  // ST is evaluated every tick, so IF-THEN already gives continuous
  // behavior. The trigger keyword choice is just for human readability.
  const ruleHeader = `(* ${describeRule(rule)} *)`;
  const source = [
    ruleHeader,
    `IF ${condResult.expr} THEN`,
    `  ${actResult.statement}`,
    `END_IF;`,
  ].join('\n');

  return { source, warnings: warnings.length > 0 ? warnings : undefined };
}

interface ExprResult {
  expr: string;
  error?: string;
  warning?: string;
}

interface StmtResult {
  statement: string;
  error?: string;
  warning?: string;
}

function compileTrigger(tiles: readonly Tile[]): ExprResult {
  // Drop the leading trigger keyword (When / While).
  if (tiles[0].kind !== 'trigger') {
    return { expr: '', error: 'Rule must start with "When" or "While".' };
  }
  const body = tiles.slice(1);
  if (body.length === 0) {
    // Permissive: a bare "When" with no condition fires every tick. Useful
    // for absolute overrides ("always set damper to 50%"). Warn so the user
    // knows that's the semantic.
    return {
      expr: 'TRUE',
      warning: 'Trigger has no condition — this rule fires every tick. Add a subject after "When" (e.g., "When zone temp exceeds setpoint") if that\'s not what you want.',
    };
  }

  // ── Shape 1: SUBJECT is LITERAL  (eg "occupancy is vacant") ──────────
  if (body.length === 3 && body[0].kind === 'subject' && body[1].token === 'is' && body[2].kind === 'literal') {
    const subj = envKeyOrFail(body[0]);
    if (!subj) return { expr: '', error: `Unknown subject "${body[0].display}".` };
    const litVal = literalToNumber(body[2]);
    return { expr: `${subj} = ${formatNum(litVal)}` };
  }

  // ── Shape 2: SUBJECT OPERATOR SUBJECT (by VALUE)?  ───────────────────
  // Eg "zone temp exceeds cooling setpoint by 1°F"
  if (
    body.length >= 3 &&
    body[0].kind === 'subject' &&
    body[1].kind === 'operator' &&
    body[2].kind === 'subject'
  ) {
    const lhs = envKeyOrFail(body[0]);
    if (!lhs) return { expr: '', error: `Unknown subject "${body[0].display}".` };
    const rhs = envKeyOrFail(body[2]);
    if (!rhs) return { expr: '', error: `Unknown subject "${body[2].display}".` };
    const op = comparator(body[1].token);
    if (!op) return { expr: '', error: `Unsupported operator "${body[1].display}" between subjects.` };
    let rhsExpr = rhs;
    if (body.length === 5 && body[3].token === 'by' && body[4].kind === 'value') {
      const offset = body[4].numericValue ?? 0;
      const sign = op.includes('>') ? '+' : '-';
      rhsExpr = `(${rhs} ${sign} ${formatNum(offset)})`;
    } else if (body.length !== 3) {
      return { expr: '', error: 'Trigger has extra tiles after the subject comparison.' };
    }
    return { expr: `${lhs} ${op} ${rhsExpr}` };
  }

  // ── Shape 3: SUBJECT OPERATOR VALUE  (eg "CO2 exceeds 800 ppm") ─────
  if (
    body.length === 3 &&
    body[0].kind === 'subject' &&
    body[1].kind === 'operator' &&
    body[2].kind === 'value'
  ) {
    const lhs = envKeyOrFail(body[0]);
    if (!lhs) return { expr: '', error: `Unknown subject "${body[0].display}".` };
    const op = comparator(body[1].token);
    if (!op) return { expr: '', error: `Unsupported operator "${body[1].display}".` };
    const rhs = body[2].numericValue ?? 0;
    return { expr: `${lhs} ${op} ${formatNum(rhs)}` };
  }

  return { expr: '', error: 'Trigger shape not recognized — try "When SUBJECT exceeds SUBJECT by VALUE" or "When SUBJECT is LITERAL".' };
}

function compileAction(tiles: readonly Tile[]): StmtResult {
  const verb = tiles[0];
  if (verb.kind !== 'action') {
    return { statement: '', error: 'Action clause must start with an action verb.' };
  }
  const rest = tiles.slice(1);

  // ── Open / Close / Set TARGET (to|equals) VALUE  ─────────────────────
  // Permissive shape: target can be ACTUATOR (normal) or SUBJECT (override
  // a sensor — diagnostic / sim-only). Connector can be "to" or "equals".
  // Extra trailing tiles become a soft warning.
  if (verb.token === 'open' || verb.token === 'close' || verb.token === 'set') {
    if (rest.length < 3) {
      return {
        statement: '',
        error: `"${verb.display}" must be followed by a target (an actuator or subject), a connector ("to" or "equals"), and a value.`,
      };
    }
    const target = rest[0];
    const connector = rest[1];
    const value = rest[2];
    const extras = rest.slice(3);

    if (target.kind !== 'actuator' && target.kind !== 'subject') {
      return {
        statement: '',
        error: `"${verb.display}" target should be an actuator like "primary damper" or a subject like "zone temp" (got ${target.kind}).`,
      };
    }
    if (connector.token !== 'to' && connector.token !== 'equals') {
      return {
        statement: '',
        error: `"${verb.display}" needs "to" or "equals" before the value (got "${connector.display}").`,
      };
    }
    if (value.kind !== 'value') {
      return {
        statement: '',
        error: `"${verb.display}" needs a numeric value tile last (got ${value.kind} "${value.display}").`,
      };
    }

    const tgt = envKeyOrFail(target);
    if (!tgt) {
      return { statement: '', error: `Unknown target "${target.display}".` };
    }
    const val = value.numericValue ?? 0;
    // Percent values normalize to 0..1 for the sim's actuator field.
    const normalized = (value.units === '%') ? val / 100 : val;

    // Build warnings for "monstrosities" — rules that compile but do
    // something the user should be aware of.
    const warnings: string[] = [];
    if (target.kind === 'subject') {
      warnings.push(`"${verb.display}" on "${target.display}" overrides a sensor reading. The sim will honor it; real hardware would no-op because sensor values are read-only.`);
    }
    // Plausibility check: zone temp = 0°F means the room is below the
    // freezing point of brine. Almost certainly a mistake (or, in our
    // user's case, an explicit decision to terrorize the tenants).
    if (target.token === 'zone-temp' && val <= 32 && value.units === '°F') {
      warnings.push(`Setting zone temp to ${val}°F is physically extreme — water freezes at 32°F. Did you mean a setpoint, or are you intentionally stress-testing the safeties?`);
    }
    if (extras.length > 0) {
      const extraNames = extras.map((t) => t.display).join(', ');
      warnings.push(`Extra tiles ignored after the value: ${extraNames}. Drop them or move them into the trigger half before "${verb.display}".`);
    }

    return {
      statement: `${tgt} := ${formatNum(normalized)};`,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined,
    };
  }

  // ── Shut down ACTUATOR  ──────────────────────────────────────────────
  if (verb.token === 'shutdown') {
    if (rest.length !== 1 || rest[0].kind !== 'actuator') {
      return { statement: '', error: '"Shut down" must be followed by an ACTUATOR.' };
    }
    const tgt = envKeyOrFail(rest[0]);
    if (!tgt) return { statement: '', error: `Unknown actuator "${rest[0].display}".` };
    return { statement: `${tgt} := 0.0;` };
  }

  // ── Modulate ACTUATOR to maintain SUBJECT at SUBJECT  ───────────────
  // Compiles to a simple proportional step toward the setpoint.
  if (verb.token === 'modulate') {
    if (
      rest.length !== 5 ||
      rest[0].kind !== 'actuator' ||
      rest[1].token !== 'maintain' ||
      rest[2].kind !== 'subject' ||
      rest[3].token !== 'at' ||
      (rest[4].kind !== 'subject' && rest[4].kind !== 'value')
    ) {
      return {
        statement: '',
        error: '"Modulate" must be followed by ACTUATOR + "to maintain" + SUBJECT + "at" + (SUBJECT or VALUE).',
      };
    }
    const tgt = envKeyOrFail(rest[0]);
    if (!tgt) return { statement: '', error: `Unknown actuator "${rest[0].display}".` };
    const pv = envKeyOrFail(rest[2]);
    if (!pv) return { statement: '', error: `Unknown subject "${rest[2].display}".` };
    const sp = rest[4].kind === 'subject'
      ? envKeyOrFail(rest[4])
      : formatNum(rest[4].numericValue ?? 0);
    if (!sp) return { statement: '', error: `Unknown subject "${rest[4].display}".` };
    // Simple proportional: actuator clamps to [0, 1] based on (pv - sp) * gain.
    // 0.1 °F error → ~5% command; 5°F error → fully driven.
    return {
      statement: `${tgt} := MAX(0.0, MIN(1.0, (${pv} - ${sp}) * 0.2));`,
    };
  }

  return { statement: '', error: `Unsupported action verb "${verb.display}".` };
}

// ── helpers ─────────────────────────────────────────────────────────────

function envKeyOrFail(tile: Tile): string | null {
  const tpl = findTileTemplate(tile.token);
  return tpl?.envKey ?? null;
}

function comparator(token: string): string | null {
  if (token === 'exceeds') return '>';
  if (token === 'is-below') return '<';
  if (token === 'equals' || token === 'is') return '=';
  return null;
}

function literalToNumber(tile: Tile): number {
  if (tile.token === 'occupied' || tile.token === 'on') return 1;
  if (tile.token === 'vacant' || tile.token === 'off') return 0;
  return 0;
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toFixed(1); // ST prefers floats with decimals
  return n.toString();
}

/** Render a rule as a single English sentence — used for the (* ... *)
 *  header comment above each emitted IF/THEN. */
export function describeRule(rule: SpecRule): string {
  return rule.tiles.map((t) => {
    if (t.kind === 'value') {
      return `${t.numericValue ?? 0}${t.units ?? ''}`;
    }
    return t.display;
  }).join(' ');
}
