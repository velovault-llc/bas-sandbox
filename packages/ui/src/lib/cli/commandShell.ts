// Cisco-IOS-style command shell for the controller CLI.
//
// Modes (akin to Cisco IOS):
//   user mode      — readonly. Prompt:  CTRL>
//   privileged     — readonly + diagnostics. Prompt:  CTRL#
//   config         — set points, change config. Prompt:  CTRL(config)#
//   program        — multi-line ST editor. Buffer commits on `END_PROGRAM` or `end` line.
//
// Commands supported per mode:
//
//   any:
//     help / ?      — show command list for current mode
//     exit          — back one level (program→config→privileged→user, user → close)
//     quit          — same as exit
//
//   user:
//     enable        — enter privileged mode (no password — this is a sim)
//
//   privileged:
//     show points         — list inputs the program can read this tick
//     show config         — show controller config (setpoint, Kp, Ki, mode, etc.)
//     show program        — show the current program source (or "<no program>")
//     show state          — show persisted VAR + PID state
//     show outputs        — show last-tick output values
//     configure terminal  — enter config mode
//     disable             — back to user mode
//
//   config:
//     set setpoint <n>     — overwrite the controller's setpoint
//     set kp <n> / set ki <n>
//     set mode cool|heat
//     program             — enter program mode
//     no program          — clear the program
//     end                 — back to privileged mode
//
//   program:
//     Each non-empty line goes into the buffer. The buffer commits when the
//     user types a line that is exactly `end` (or `END_PROGRAM` on its own).
//     During program mode the prompt is `CTRL(config-prog)# `.

import type { ControllerProgram } from './programStore.svelte';
import { findControllerModel } from '@bas/core';

export type ShellMode = 'user' | 'privileged' | 'config' | 'program';

export interface ControllerContext {
  readonly controllerId: string;
  readonly controllerLabel: string;
  /** Sensed/setpoint/oat/actuator from the controller's last tick. */
  readonly snapshot: () => {
    sensed: number;
    setpoint: number;
    oat: number;
    actuator: number;
    mode: 'cool' | 'heat';
    Kp: number;
    Ki: number;
    vendorModelId?: string;
  };
  /** Mutate the controller config from the CLI. */
  readonly setConfig: (key: 'setpoint' | 'Kp' | 'Ki' | 'mode', value: number | string) => string | null;
  readonly getProgram: () => ControllerProgram | undefined;
  readonly setProgram: (source: string) => ControllerProgram;
  readonly clearProgram: () => void;
}

export interface ShellResponse {
  /** Lines of output to print to the terminal (UTF-8, no ANSI). */
  readonly lines: readonly string[];
  /** New mode after this command. */
  readonly mode: ShellMode;
  /** True if the CLI should close (user typed `exit` from user mode). */
  readonly close?: boolean;
}

export interface ShellState {
  mode: ShellMode;
  /** Buffered ST source while in program mode. */
  programBuffer: string;
}

export function makeShellState(): ShellState {
  return { mode: 'user', programBuffer: '' };
}

export function promptFor(state: ShellState, label: string): string {
  switch (state.mode) {
    case 'user':
      return `${label}> `;
    case 'privileged':
      return `${label}# `;
    case 'config':
      return `${label}(config)# `;
    case 'program':
      return `${label}(config-prog)# `;
  }
}

export function dispatch(
  raw: string,
  state: ShellState,
  ctx: ControllerContext,
): ShellResponse {
  // Program mode: every line goes to the buffer except `end` / `END_PROGRAM`
  if (state.mode === 'program') {
    return handleProgramLine(raw, state, ctx);
  }
  const line = raw.trim();
  if (line === '') return reply(state, []);

  // Assignment-shape detection: if the raw line contains `:=`, this is almost
  // certainly ST. Surface the same nudge as the keyword detector below, so
  // pasting `actuator := 0.42;` in user mode prints the helpful hint instead
  // of "Unknown command actuator".
  if (line.includes(':=') && (state.mode === 'user' || state.mode === 'privileged')) {
    return reply(state, [
      `% That looks like Structured Text.`,
      `  Type "program" to drop into the ST editor, then paste your code.`,
    ]);
  }

  const [cmd, ...rest] = line.split(/\s+/);
  const cmdLower = cmd.toLowerCase();

  if (cmdLower === 'help' || cmdLower === '?') return helpFor(state);
  if (cmdLower === 'exit' || cmdLower === 'quit') return handleExit(state);

  switch (state.mode) {
    case 'user':
      return userCmd(cmdLower, rest, state, ctx);
    case 'privileged':
      return privCmd(cmdLower, rest, state, ctx);
    case 'config':
      return configCmd(cmdLower, rest, state, ctx);
  }
}

function reply(state: ShellState, lines: readonly string[], close = false): ShellResponse {
  return { lines, mode: state.mode, close };
}

function handleExit(state: ShellState): ShellResponse {
  switch (state.mode) {
    case 'program':
      // Discard buffer without commit
      state.programBuffer = '';
      state.mode = 'config';
      return reply(state, ['  (program buffer discarded)']);
    case 'config':
      state.mode = 'privileged';
      return reply(state, []);
    case 'privileged':
      state.mode = 'user';
      return reply(state, []);
    case 'user':
      return reply(state, ['  closing terminal'], true);
  }
}

function userCmd(cmd: string, args: string[], state: ShellState, ctx: ControllerContext): ShellResponse {
  if (cmd === 'enable') {
    state.mode = 'privileged';
    return reply(state, []);
  }
  if (cmd === 'show') return privCmd('show', args, state, ctx); // allow read-only show in user mode
  // Shortcut: `program` from user mode auto-elevates through enable +
  // configure terminal + program. Saves the typical three-step IOS chain
  // when the user just wants to write code.
  if (cmd === 'program') {
    state.mode = 'config';
    return configCmd('program', args, state, ctx);
  }
  // Friendly nudge when the user pastes ST-shaped input directly into
  // user mode (e.g. `actuator := 1.0;` or `IF sensed > 70.0 THEN`).
  if (looksLikeSt(cmd)) {
    return reply(state, [
      `% Unknown command "${cmd}" in user mode.`,
      `  Looks like Structured Text — type "program" to drop into the ST editor first.`,
    ]);
  }
  return reply(state, [`% Unknown command "${cmd}" in user mode — try "enable" or "help"`]);
}

const ST_KEYWORDS = /^(IF|ELSIF|ELSE|END_IF|END_PROGRAM|VAR|END_VAR|PROGRAM|FOR|WHILE)$/i;
function looksLikeSt(firstToken: string): boolean {
  return ST_KEYWORDS.test(firstToken);
}

function privCmd(cmd: string, args: string[], state: ShellState, ctx: ControllerContext): ShellResponse {
  if (cmd === 'disable') {
    state.mode = 'user';
    return reply(state, []);
  }
  if (cmd === 'configure' && args[0]?.toLowerCase() === 'terminal') {
    state.mode = 'config';
    return reply(state, ['Enter configuration commands, one per line.  End with "end" or Ctrl-Z.']);
  }
  // Shortcut: `program` from privileged mode auto-enters config + program.
  if (cmd === 'program') {
    state.mode = 'config';
    return configCmd('program', args, state, ctx);
  }
  if (cmd === 'show') {
    return handleShow(args, state, ctx);
  }
  return reply(state, [`% Unknown command "${cmd}" — try "show ?" or "configure terminal"`]);
}

function configCmd(cmd: string, args: string[], state: ShellState, ctx: ControllerContext): ShellResponse {
  if (cmd === 'end') {
    state.mode = 'privileged';
    return reply(state, []);
  }
  if (cmd === 'set') return handleSet(args, state, ctx);
  if (cmd === 'no') return handleNo(args, state, ctx);
  if (cmd === 'program') {
    state.mode = 'program';
    state.programBuffer = '';
    return reply(state, [
      'Enter ST program lines one per command. Type "end" alone to commit, "exit" to discard.',
      'Inputs (read-only): sensed, setpoint, oat, zone, pi_out, dt',
      'Outputs you can assign: actuator (0..1), setpoint (°F), or any name (persists in VAR space)',
    ]);
  }
  if (cmd === 'show') return handleShow(args, state, ctx); // show still works in config
  return reply(state, [`% Unknown config command "${cmd}" — try "set ?" or "end"`]);
}

function handleShow(args: string[], state: ShellState, ctx: ControllerContext): ShellResponse {
  const sub = args[0]?.toLowerCase();
  if (!sub || sub === '?') {
    return reply(state, [
      'show config        — controller setpoint / Kp / Ki / mode',
      'show points        — input values visible to the program',
      'show program       — current ST program source',
      'show state         — persisted VAR / PID state',
      'show outputs       — last-tick output writes',
    ]);
  }
  const s = ctx.snapshot();
  if (sub === 'config') {
    const lines: string[] = [
      `  controller : ${ctx.controllerLabel}`,
      `  mode       : ${s.mode}`,
      `  setpoint   : ${s.setpoint.toFixed(2)} °F`,
      `  Kp         : ${s.Kp.toFixed(3)}`,
      `  Ki         : ${s.Ki.toFixed(3)}`,
    ];
    if (s.vendorModelId) {
      const m = findControllerModel(s.vendorModelId);
      if (m) {
        lines.push('');
        lines.push(`  vendor     : ${m.vendor} ${m.model}`);
        lines.push(`  family     : ${m.family} · ${m.role}`);
        lines.push(`  language   : ${m.programmingLanguage}`);
        lines.push(`  protocols  : ${m.protocols.join(', ')}`);
        lines.push(`  capacity   : ${m.maxPoints} points`);
        if (!m.stPortable) {
          lines.push('');
          lines.push(`  ! ST programs on this controller are simulated only —`);
          lines.push(`    real ${m.vendor} hardware programs in ${m.programmingLanguage}.`);
        }
      }
    }
    return reply(state, lines);
  }
  if (sub === 'points') {
    return reply(state, [
      `  sensed     : ${s.sensed.toFixed(2)} °F`,
      `  setpoint   : ${s.setpoint.toFixed(2)} °F`,
      `  oat        : ${s.oat.toFixed(2)} °F`,
      `  actuator   : ${(s.actuator * 100).toFixed(1)} %`,
    ]);
  }
  if (sub === 'program') {
    const p = ctx.getProgram();
    if (!p || !p.source) return reply(state, ['  <no program>']);
    const lines = p.source.split('\n').map((ln, i) => `  ${String(i + 1).padStart(3)}  ${ln}`);
    if (p.error) lines.push('', `  ! compile error: ${p.error}`);
    return reply(state, lines);
  }
  if (sub === 'state') {
    const p = ctx.getProgram();
    if (!p) return reply(state, ['  <no program>']);
    const keys = Object.keys(p.state);
    if (keys.length === 0) return reply(state, ['  <state empty>']);
    return reply(
      state,
      keys.map((k) => `  ${k.padEnd(28)} ${p.state[k]}`),
    );
  }
  if (sub === 'outputs') {
    return reply(state, [
      '  (outputs are written to the simulator each tick — see chart and inspector for live values)',
    ]);
  }
  return reply(state, [`% Unknown "show ${sub}"`]);
}

function handleSet(args: string[], state: ShellState, ctx: ControllerContext): ShellResponse {
  const key = args[0]?.toLowerCase();
  const valRaw = args[1];
  if (!key || valRaw === undefined) {
    return reply(state, ['Usage: set <setpoint|kp|ki|mode> <value>']);
  }
  if (key === 'mode') {
    if (valRaw !== 'cool' && valRaw !== 'heat') {
      return reply(state, [`% mode must be "cool" or "heat", got "${valRaw}"`]);
    }
    const err = ctx.setConfig('mode', valRaw);
    return reply(state, [err ? `% ${err}` : `  mode = ${valRaw}`]);
  }
  const value = Number(valRaw);
  if (!Number.isFinite(value)) {
    return reply(state, [`% expected number, got "${valRaw}"`]);
  }
  const map: Record<string, 'setpoint' | 'Kp' | 'Ki'> = {
    setpoint: 'setpoint',
    sp: 'setpoint',
    kp: 'Kp',
    ki: 'Ki',
  };
  const field = map[key];
  if (!field) return reply(state, [`% unknown setting "${key}"`]);
  const err = ctx.setConfig(field, value);
  return reply(state, [err ? `% ${err}` : `  ${field} = ${value}`]);
}

function handleNo(args: string[], state: ShellState, ctx: ControllerContext): ShellResponse {
  if (args[0]?.toLowerCase() === 'program') {
    ctx.clearProgram();
    return reply(state, ['  program cleared']);
  }
  return reply(state, [`% "no ${args.join(' ')}" not supported`]);
}

function handleProgramLine(raw: string, state: ShellState, ctx: ControllerContext): ShellResponse {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'end' || trimmed.toUpperCase() === 'END_PROGRAM') {
    const source = state.programBuffer;
    state.programBuffer = '';
    state.mode = 'privileged';
    if (!source.trim()) {
      return reply(state, ['  (empty buffer — no program saved)']);
    }
    const prog = ctx.setProgram(source);
    if (prog.error) {
      return reply(state, [
        `% program compile failed: ${prog.error}`,
        '  (source kept for editing — re-enter program mode to fix)',
      ]);
    }
    return reply(state, ['  program compiled and active']);
  }
  if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
    return handleExit(state);
  }
  state.programBuffer += (state.programBuffer ? '\n' : '') + raw;
  return reply(state, []);
}

function helpFor(state: ShellState): ShellResponse {
  if (state.mode === 'user') {
    return reply(state, [
      'enable                — enter privileged mode',
      'program               — shortcut: enter ST editor (skips enable/config)',
      'show ...              — read-only diagnostics',
      'exit                  — close terminal',
    ]);
  }
  if (state.mode === 'privileged') {
    return reply(state, [
      'show ...              — diagnostics (try "show ?" for sub-commands)',
      'configure terminal    — enter config mode',
      'disable               — drop back to user mode',
      'exit                  — drop back one level',
    ]);
  }
  if (state.mode === 'config') {
    return reply(state, [
      'set <key> <value>     — setpoint | kp | ki | mode',
      'program               — multi-line ST editor (commit with "end")',
      'no program            — clear the program',
      'end                   — back to privileged mode',
    ]);
  }
  // program
  return reply(state, [
    '  (program mode — every line goes to the buffer)',
    '  Type "end" alone to commit, "exit" to discard.',
  ]);
}
