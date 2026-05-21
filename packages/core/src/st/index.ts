// @bas/core ST — minimal IEC 61131-3 Structured Text for the BAS sandbox.

import { LexError, tokenize, type Token } from './lexer.js';
import { parse, ParseError } from './parser.js';
import { makeEnv, runProgram, RuntimeError, type Env } from './interpreter.js';
import type { Program } from './ast.js';

export { tokenize, parse, runProgram, makeEnv };
export { LexError, ParseError, RuntimeError };
export type { Program, Env, Token };
export type * from './ast.js';

export interface CompileResult {
  readonly ok: boolean;
  readonly program?: Program;
  readonly error?: string;
  readonly errorLine?: number;
  readonly errorCol?: number;
}

/**
 * Convenience: tokenize + parse in one call, returning a discriminated
 * result instead of throwing. CLI / editor wraps this to surface error
 * messages without try/catch noise.
 */
export function compile(source: string): CompileResult {
  try {
    const tokens = tokenize(source);
    const program = parse(tokens);
    return { ok: true, program };
  } catch (err) {
    if (err instanceof LexError || err instanceof ParseError) {
      return { ok: false, error: err.message, errorLine: err.line, errorCol: err.col };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
