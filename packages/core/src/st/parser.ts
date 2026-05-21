// Recursive-descent parser for the ST subset. Produces a Program AST.
//
// Grammar (rough):
//   program        := 'PROGRAM' ident varBlock? statement* 'END_PROGRAM'
//   varBlock       := 'VAR' varDecl* 'END_VAR'
//   varDecl        := ident ':' typeName ( ':=' expression )? ';'
//   typeName       := 'REAL' | 'LREAL' | 'INT' | 'DINT' | 'BOOL'
//   statement      := assignStmt | ifStmt
//   assignStmt     := ident ':=' expression ';'
//   ifStmt         := 'IF' expression 'THEN' statement* ifTail 'END_IF' ';'?
//   ifTail         := ( 'ELSIF' expression 'THEN' statement* )* ( 'ELSE' statement* )?
//   expression     := orExpr
//   orExpr         := xorExpr ( ('OR') xorExpr )*
//   xorExpr        := andExpr ( ('XOR') andExpr )*
//   andExpr        := relExpr ( ('AND') relExpr )*
//   relExpr        := addExpr ( ('='|'<>'|'<'|'<='|'>'|'>=') addExpr )?
//   addExpr        := mulExpr ( ('+'|'-') mulExpr )*
//   mulExpr        := unaryExpr ( ('*'|'/'|'MOD') unaryExpr )*
//   unaryExpr      := ('-'|'NOT')? primary
//   primary        := number | boolean | ident ( '(' argList? ')' )? | '(' expression ')'

import type {
  AssignStmt,
  BinaryExpr,
  BinaryOp,
  CallExpr,
  Expr,
  IdentExpr,
  IfBranch,
  IfStmt,
  LiteralExpr,
  Program,
  Statement,
  StType,
  UnaryExpr,
  VarDecl,
} from './ast.js';
import type { Token, TokenKind } from './lexer.js';

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'ParseError';
  }
}

export function parse(tokens: readonly Token[]): Program {
  const p = new Parser(tokens);
  return p.parseProgram();
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[this.i + offset] ?? this.tokens[this.tokens.length - 1];
  }
  private consume(): Token {
    return this.tokens[this.i++];
  }
  private match(kind: TokenKind): boolean {
    if (this.peek().kind === kind) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(kind: TokenKind, message?: string): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new ParseError(message ?? `Expected ${kind} but got ${tok.kind} ("${tok.text}")`, tok.line, tok.col);
    }
    return this.consume();
  }

  parseProgram(): Program {
    // PROGRAM keyword is optional — a bare statement block is the common
    // "type this in the CLI" entry point. If present, consume name + matching
    // END_PROGRAM. If absent, parse to EOF.
    let name = 'Main';
    let needsEndProgram = false;
    if (this.peek().kind === 'kw_program') {
      this.consume();
      const id = this.expect('identifier', 'Program name expected after PROGRAM');
      name = id.text;
      needsEndProgram = true;
    }

    const vars = this.peek().kind === 'kw_var' ? this.parseVarBlock() : [];
    const body: Statement[] = [];
    while (this.peek().kind !== 'eof' && this.peek().kind !== 'kw_end_program') {
      body.push(this.parseStatement());
    }
    if (needsEndProgram) {
      this.expect('kw_end_program');
      this.match('semicolon');
    }
    if (this.peek().kind !== 'eof') {
      const t = this.peek();
      throw new ParseError(`Unexpected token "${t.text}" after END_PROGRAM`, t.line, t.col);
    }
    return { kind: 'program', name, vars, body };
  }

  private parseVarBlock(): VarDecl[] {
    this.expect('kw_var');
    const out: VarDecl[] = [];
    while (this.peek().kind !== 'kw_end_var') {
      out.push(this.parseVarDecl());
    }
    this.expect('kw_end_var');
    this.match('semicolon');
    return out;
  }

  private parseVarDecl(): VarDecl {
    const id = this.expect('identifier', 'Variable name expected');
    this.expect('colon');
    const typeTok = this.consume();
    let type: StType;
    if (typeTok.kind === 'type_real') type = 'REAL';
    else if (typeTok.kind === 'type_int') type = 'INT';
    else if (typeTok.kind === 'type_bool') type = 'BOOL';
    else throw new ParseError(`Unknown type "${typeTok.text}"`, typeTok.line, typeTok.col);
    let init: Expr | null = null;
    if (this.match('op_assign')) {
      init = this.parseExpr();
    }
    this.expect('semicolon');
    return { name: id.text, type, init };
  }

  private parseStatement(): Statement {
    const tok = this.peek();
    if (tok.kind === 'kw_if') return this.parseIf();
    if (tok.kind === 'identifier') return this.parseAssign();
    throw new ParseError(`Unexpected token "${tok.text}" at start of statement`, tok.line, tok.col);
  }

  private parseAssign(): AssignStmt {
    const id = this.expect('identifier');
    this.expect('op_assign', 'Expected := after target');
    const value = this.parseExpr();
    this.expect('semicolon');
    return { kind: 'assign', target: id.text, value, line: id.line };
  }

  private parseIf(): IfStmt {
    const ifTok = this.expect('kw_if');
    const branches: IfBranch[] = [];
    const cond = this.parseExpr();
    this.expect('kw_then');
    const body: Statement[] = [];
    while (
      this.peek().kind !== 'kw_else' &&
      this.peek().kind !== 'kw_elsif' &&
      this.peek().kind !== 'kw_end_if'
    ) {
      body.push(this.parseStatement());
    }
    branches.push({ cond, body });

    while (this.peek().kind === 'kw_elsif') {
      this.consume();
      const c2 = this.parseExpr();
      this.expect('kw_then');
      const b2: Statement[] = [];
      while (
        this.peek().kind !== 'kw_else' &&
        this.peek().kind !== 'kw_elsif' &&
        this.peek().kind !== 'kw_end_if'
      ) {
        b2.push(this.parseStatement());
      }
      branches.push({ cond: c2, body: b2 });
    }

    let elseBody: Statement[] | null = null;
    if (this.match('kw_else')) {
      elseBody = [];
      while (this.peek().kind !== 'kw_end_if') {
        elseBody.push(this.parseStatement());
      }
    }
    this.expect('kw_end_if');
    this.match('semicolon');
    return { kind: 'if', branches, elseBody, line: ifTok.line };
  }

  // expression parsing — Pratt-ish, precedence-climbing

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseXor();
    while (this.peek().kind === 'kw_or') {
      this.consume();
      const right = this.parseXor();
      left = { kind: 'binary', op: 'OR', left, right } satisfies BinaryExpr;
    }
    return left;
  }

  private parseXor(): Expr {
    let left = this.parseAnd();
    while (this.peek().kind === 'kw_xor') {
      this.consume();
      const right = this.parseAnd();
      left = { kind: 'binary', op: 'XOR', left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseRel();
    while (this.peek().kind === 'kw_and') {
      this.consume();
      const right = this.parseRel();
      left = { kind: 'binary', op: 'AND', left, right };
    }
    return left;
  }

  private parseRel(): Expr {
    const left = this.parseAdd();
    const relOps: Partial<Record<TokenKind, BinaryOp>> = {
      op_eq: '=',
      op_neq: '<>',
      op_lt: '<',
      op_lte: '<=',
      op_gt: '>',
      op_gte: '>=',
    };
    const op = relOps[this.peek().kind];
    if (op) {
      this.consume();
      const right = this.parseAdd();
      return { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.peek().kind === 'op_plus' || this.peek().kind === 'op_minus') {
      const tok = this.consume();
      const right = this.parseMul();
      left = { kind: 'binary', op: tok.kind === 'op_plus' ? '+' : '-', left, right };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    while (
      this.peek().kind === 'op_mul' ||
      this.peek().kind === 'op_div' ||
      this.peek().kind === 'kw_mod'
    ) {
      const tok = this.consume();
      const right = this.parseUnary();
      const op: BinaryOp = tok.kind === 'op_mul' ? '*' : tok.kind === 'op_div' ? '/' : 'MOD';
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.peek().kind === 'op_minus') {
      this.consume();
      return { kind: 'unary', op: '-', arg: this.parseUnary() } satisfies UnaryExpr;
    }
    if (this.peek().kind === 'kw_not') {
      this.consume();
      return { kind: 'unary', op: 'NOT', arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    if (tok.kind === 'number') {
      this.consume();
      const isInt = Number.isInteger(tok.value!) && !tok.text.includes('.') && !tok.text.includes('e') && !tok.text.includes('E');
      return { kind: 'literal', value: tok.value!, type: isInt ? 'int' : 'real' } satisfies LiteralExpr;
    }
    if (tok.kind === 'boolean' || tok.kind === 'kw_true' || tok.kind === 'kw_false') {
      this.consume();
      const v = tok.kind === 'kw_true' || tok.text.toUpperCase() === 'TRUE' ? 1 : 0;
      return { kind: 'literal', value: v, type: 'bool' };
    }
    if (tok.kind === 'lparen') {
      this.consume();
      const e = this.parseExpr();
      this.expect('rparen');
      return e;
    }
    if (tok.kind === 'identifier') {
      this.consume();
      // function call?
      if (this.peek().kind === 'lparen') {
        this.consume();
        const args: Expr[] = [];
        if (this.peek().kind !== 'rparen') {
          args.push(this.parseExpr());
          while (this.match('comma')) {
            args.push(this.parseExpr());
          }
        }
        this.expect('rparen');
        return { kind: 'call', name: tok.text, args, line: tok.line } satisfies CallExpr;
      }
      return { kind: 'ident', name: tok.text, line: tok.line } satisfies IdentExpr;
    }
    throw new ParseError(`Unexpected token "${tok.text}" in expression`, tok.line, tok.col);
  }
}
