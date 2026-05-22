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

import type { SpecProgram, SpecRule, Tile } from './types.js';
import { findTileTemplate } from './tiles.js';

export interface CompileResult {
  readonly ok: boolean;
  /** Compiled ST source. Empty string when ok = false. */
  readonly source: string;
  /** Per-rule error messages (rule.id → message). */
  readonly errors: ReadonlyMap<string, string>;
  /** Lines emitted per rule (rule.id → ST line). Useful for the UI's
   *  "show as code" toggle that highlights which rule made which line. */
  readonly byRule: ReadonlyMap<string, string>;
}

export function compileSpecLang(program: SpecProgram): CompileResult {
  const errors = new Map<string, string>();
  const byRule = new Map<string, string>();
  const lines: string[] = [];

  if (program.rules.length === 0) {
    return { ok: true, source: '', errors, byRule };
  }

  // Header comment so users opening "show as code" see this is SpecLang-generated.
  lines.push('(* Compiled from SpecLang — edit the tile rules to regenerate. *)');
  lines.push('');

  for (const rule of program.rules) {
    const result = compileRule(rule);
    if (result.error) {
      errors.set(rule.id, result.error);
      lines.push(`(* rule ${rule.id}: ${result.error} *)`);
      byRule.set(rule.id, '');
    } else {
      lines.push(result.source);
      byRule.set(rule.id, result.source);
    }
    lines.push('');
  }

  return {
    ok: errors.size === 0,
    source: lines.join('\n').trimEnd() + '\n',
    errors,
    byRule,
  };
}

interface RuleCompileResult {
  source: string;
  error?: string;
}

function compileRule(rule: SpecRule): RuleCompileResult {
  if (rule.tiles.length === 0) {
    return { source: '', error: 'Empty rule.' };
  }

  // Split tiles into trigger clause + action clause at the first ACTION tile.
  const actionIdx = rule.tiles.findIndex((t) => t.kind === 'action');
  if (actionIdx === -1) {
    return { source: '', error: 'Rule has no action — add an action tile like "Open" or "Modulate".' };
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

  return { source };
}

interface ExprResult {
  expr: string;
  error?: string;
}

interface StmtResult {
  statement: string;
  error?: string;
}

function compileTrigger(tiles: readonly Tile[]): ExprResult {
  // Drop the leading trigger keyword (When / While).
  if (tiles[0].kind !== 'trigger') {
    return { expr: '', error: 'Rule must start with "When" or "While".' };
  }
  const body = tiles.slice(1);
  if (body.length === 0) {
    return { expr: '', error: 'Trigger has no condition — add a subject like "zone temp" after "When".' };
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

  // ── Open / Close / Set ACTUATOR to VALUE  ────────────────────────────
  if (verb.token === 'open' || verb.token === 'close' || verb.token === 'set') {
    if (rest.length !== 3 || rest[0].kind !== 'actuator' || rest[1].token !== 'to' || rest[2].kind !== 'value') {
      return { statement: '', error: `"${verb.display}" must be followed by ACTUATOR + "to" + VALUE.` };
    }
    const tgt = envKeyOrFail(rest[0]);
    if (!tgt) return { statement: '', error: `Unknown actuator "${rest[0].display}".` };
    const val = rest[2].numericValue ?? 0;
    // Percent values normalize to 0..1 for the sim's actuator field.
    const normalized = (rest[2].units === '%') ? val / 100 : val;
    return { statement: `${tgt} := ${formatNum(normalized)};` };
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
