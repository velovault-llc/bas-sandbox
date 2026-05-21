// Minimal IEC 61131-3 Structured Text lexer.
//
// Tokenizes a small ST subset adequate for HVAC control snippets a tech
// might write in the controller's CLI:
//
//   PROGRAM Main
//   VAR
//     sensed: REAL;
//     setpoint: REAL := 72.0;
//   END_VAR
//
//   IF sensed > setpoint THEN
//     actuator := MIN(1.0, (sensed - setpoint) * 0.1);
//   ELSE
//     actuator := 0.0;
//   END_IF
//   END_PROGRAM
//
// Out of scope (for now): function blocks, function calls beyond a fixed
// built-in set, arrays, structs, FOR/WHILE/REPEAT, time literals.

export type TokenKind =
  // structural
  | 'identifier'
  | 'number'
  | 'string'
  | 'boolean'
  | 'eof'
  // keywords
  | 'kw_program'
  | 'kw_end_program'
  | 'kw_var'
  | 'kw_end_var'
  | 'kw_if'
  | 'kw_then'
  | 'kw_else'
  | 'kw_elsif'
  | 'kw_end_if'
  | 'kw_and'
  | 'kw_or'
  | 'kw_not'
  | 'kw_xor'
  | 'kw_mod'
  | 'kw_true'
  | 'kw_false'
  // type names
  | 'type_real'
  | 'type_int'
  | 'type_bool'
  // operators
  | 'op_assign' // :=
  | 'op_plus'
  | 'op_minus'
  | 'op_mul'
  | 'op_div'
  | 'op_eq' // =
  | 'op_neq' // <>
  | 'op_lt'
  | 'op_lte'
  | 'op_gt'
  | 'op_gte'
  // punctuation
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'semicolon'
  | 'colon';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  /** 1-indexed source line for error reporting. */
  readonly line: number;
  /** 1-indexed source column. */
  readonly col: number;
  /** Parsed numeric value (only set when kind === 'number'). */
  readonly value?: number;
}

const KEYWORDS: Record<string, TokenKind> = {
  PROGRAM: 'kw_program',
  END_PROGRAM: 'kw_end_program',
  VAR: 'kw_var',
  END_VAR: 'kw_end_var',
  IF: 'kw_if',
  THEN: 'kw_then',
  ELSE: 'kw_else',
  ELSIF: 'kw_elsif',
  END_IF: 'kw_end_if',
  AND: 'kw_and',
  OR: 'kw_or',
  NOT: 'kw_not',
  XOR: 'kw_xor',
  MOD: 'kw_mod',
  TRUE: 'kw_true',
  FALSE: 'kw_false',
  REAL: 'type_real',
  LREAL: 'type_real',
  INT: 'type_int',
  DINT: 'type_int',
  BOOL: 'type_bool',
};

export class LexError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'LexError';
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const isIdStart = (c: string): boolean => /[A-Za-z_]/.test(c);
  const isIdCont = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

  while (i < source.length) {
    const c = source[i];
    const col = i - lineStart + 1;

    // whitespace
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }

    // line comment // ...
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // block comment (* ... *)
    if (c === '(' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === ')')) {
        if (source[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (i >= source.length) {
        throw new LexError('Unterminated block comment', line, col);
      }
      i += 2;
      continue;
    }

    // number — 1, 1.0, .5, 1.5e-2
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i;
      while (i < source.length && /[0-9]/.test(source[i])) i++;
      if (source[i] === '.') {
        i++;
        while (i < source.length && /[0-9]/.test(source[i])) i++;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        i++;
        if (source[i] === '+' || source[i] === '-') i++;
        while (i < source.length && /[0-9]/.test(source[i])) i++;
      }
      const text = source.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new LexError(`Invalid numeric literal "${text}"`, line, col);
      }
      tokens.push({ kind: 'number', text, line, col, value });
      continue;
    }

    // identifier / keyword
    if (isIdStart(c)) {
      const start = i;
      i++;
      while (i < source.length && isIdCont(source[i])) i++;
      const text = source.slice(start, i);
      const upper = text.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ kind: 'boolean', text, line, col, value: upper === 'TRUE' ? 1 : 0 });
        continue;
      }
      const kw = KEYWORDS[upper];
      if (kw) {
        tokens.push({ kind: kw, text: upper, line, col });
      } else {
        tokens.push({ kind: 'identifier', text, line, col });
      }
      continue;
    }

    // multi-char operators
    if (c === ':' && source[i + 1] === '=') {
      tokens.push({ kind: 'op_assign', text: ':=', line, col });
      i += 2;
      continue;
    }
    if (c === '<' && source[i + 1] === '=') {
      tokens.push({ kind: 'op_lte', text: '<=', line, col });
      i += 2;
      continue;
    }
    if (c === '>' && source[i + 1] === '=') {
      tokens.push({ kind: 'op_gte', text: '>=', line, col });
      i += 2;
      continue;
    }
    if (c === '<' && source[i + 1] === '>') {
      tokens.push({ kind: 'op_neq', text: '<>', line, col });
      i += 2;
      continue;
    }

    // single-char tokens
    const single: Record<string, TokenKind> = {
      '+': 'op_plus',
      '-': 'op_minus',
      '*': 'op_mul',
      '/': 'op_div',
      '=': 'op_eq',
      '<': 'op_lt',
      '>': 'op_gt',
      '(': 'lparen',
      ')': 'rparen',
      ',': 'comma',
      ';': 'semicolon',
      ':': 'colon',
    };
    if (c in single) {
      tokens.push({ kind: single[c], text: c, line, col });
      i++;
      continue;
    }

    throw new LexError(`Unexpected character "${c}"`, line, col);
  }

  tokens.push({ kind: 'eof', text: '', line, col: i - lineStart + 1 });
  return tokens;
}
