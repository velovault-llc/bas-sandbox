// AST node types for the ST subset. Kept narrow so the interpreter is short.

export type StType = 'REAL' | 'INT' | 'BOOL';

export interface VarDecl {
  readonly name: string;
  readonly type: StType;
  /** Initial value expression. null = type default (0 / 0.0 / FALSE). */
  readonly init: Expr | null;
}

export interface Program {
  readonly kind: 'program';
  readonly name: string;
  readonly vars: readonly VarDecl[];
  readonly body: readonly Statement[];
}

export type Statement = AssignStmt | IfStmt;

export interface AssignStmt {
  readonly kind: 'assign';
  readonly target: string;
  readonly value: Expr;
  readonly line: number;
}

export interface IfStmt {
  readonly kind: 'if';
  readonly branches: readonly IfBranch[];
  readonly elseBody: readonly Statement[] | null;
  readonly line: number;
}

export interface IfBranch {
  readonly cond: Expr;
  readonly body: readonly Statement[];
}

export type Expr = LiteralExpr | IdentExpr | BinaryExpr | UnaryExpr | CallExpr;

export interface LiteralExpr {
  readonly kind: 'literal';
  readonly value: number;
  readonly type: 'real' | 'int' | 'bool';
}

export interface IdentExpr {
  readonly kind: 'ident';
  readonly name: string;
  readonly line: number;
}

export type BinaryOp = '+' | '-' | '*' | '/' | 'MOD' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'AND' | 'OR' | 'XOR';

export interface BinaryExpr {
  readonly kind: 'binary';
  readonly op: BinaryOp;
  readonly left: Expr;
  readonly right: Expr;
}

export type UnaryOp = '-' | 'NOT';

export interface UnaryExpr {
  readonly kind: 'unary';
  readonly op: UnaryOp;
  readonly arg: Expr;
}

export interface CallExpr {
  readonly kind: 'call';
  readonly name: string;
  readonly args: readonly Expr[];
  readonly line: number;
}
