// Evaluator for the calc expressions in skills.txt (aurastatcalc, aurarangecalc, calc1..4,
// petmax and so on). Integer arithmetic throughout, division truncates like the game.
//
// Supported: integers, + - * / with unary minus, comparisons, ?:, parentheses,
// min(a, b), max(a, b), parN, lvl, blvl, the linear and diminishing helpers
// ln12/ln34/ln56/ln78 and dm12/dm34/dm56/dm78, and enms/exms (the skill's elemental
// min/max at lvl). Synergies (skill('X'.blvl) and similar) and character stats (toht,
// stat(...)) evaluate to 0: a tower has no other skills or character sheet.

import { idiv } from './fixed.ts';

export interface CalcContext {
  lvl: number;
  /** Param1..Param8, index 0 is Param1. Missing params are 0. */
  params: readonly number[];
  /** Elemental min and max at lvl, for enms and exms. */
  elementalMin?: number;
  elementalMax?: number;
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'str'; value: string }
  | { kind: 'op'; value: string };

const OPS = ['<=', '>=', '==', '!=', '<', '>', '+', '-', '*', '/', '?', ':', '(', ')', ',', '.'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '"') {
      i++;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j]!)) j++;
      tokens.push({ kind: 'num', value: Number(src.slice(i, j)) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      tokens.push({ kind: 'ident', value: src.slice(i, j).toLowerCase() });
      i = j;
    } else if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new Error(`calc: unterminated string in ${src}`);
      tokens.push({ kind: 'str', value: src.slice(i + 1, j) });
      i = j + 1;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new Error(`calc: unexpected '${c}' in ${src}`);
      tokens.push({ kind: 'op', value: op });
      i += op.length;
    }
  }
  return tokens;
}

/** D2's linear helper: a + (lvl - 1) * b. */
export function linear(a: number, b: number, lvl: number): number {
  return a + (lvl - 1) * b;
}

/** D2's diminishing helper: a + (110 * lvl) * (b - a) / (100 * (lvl + 6)). */
export function diminishing(a: number, b: number, lvl: number): number {
  return a + idiv(110 * lvl * (b - a), 100 * (lvl + 6));
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly ctx: CalcContext,
    private readonly src: string,
  ) {}

  parse(): number {
    const value = this.ternary();
    if (this.pos < this.tokens.length) throw new Error(`calc: trailing input in ${this.src}`);
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t?.kind === 'op' && t.value === value;
  }

  private expect(value: string): void {
    if (!this.isOp(value)) throw new Error(`calc: expected '${value}' in ${this.src}`);
    this.pos++;
  }

  private ternary(): number {
    const cond = this.comparison();
    if (!this.isOp('?')) return cond;
    this.pos++;
    const a = this.ternary();
    this.expect(':');
    const b = this.ternary();
    return cond !== 0 ? a : b;
  }

  private comparison(): number {
    let left = this.additive();
    for (;;) {
      const t = this.peek();
      if (t?.kind !== 'op' || !['<', '>', '<=', '>=', '==', '!='].includes(t.value)) return left;
      this.pos++;
      const right = this.additive();
      const r =
        t.value === '<' ? left < right
        : t.value === '>' ? left > right
        : t.value === '<=' ? left <= right
        : t.value === '>=' ? left >= right
        : t.value === '==' ? left === right
        : left !== right;
      left = r ? 1 : 0;
    }
  }

  private additive(): number {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.pos++] as { value: string }).value;
      const right = this.multiplicative();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private multiplicative(): number {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.tokens[this.pos++] as { value: string }).value;
      const right = this.unary();
      left = op === '*' ? left * right : right === 0 ? 0 : idiv(left, right);
    }
    return left;
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.pos++;
      return -this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error(`calc: unexpected end of ${this.src}`);
    if (t.kind === 'num') return t.value;
    if (t.kind === 'op' && t.value === '(') {
      const v = this.ternary();
      this.expect(')');
      return v;
    }
    if (t.kind === 'ident') return this.identifier(t.value);
    throw new Error(`calc: unexpected token in ${this.src}`);
  }

  private args(): number[] {
    this.expect('(');
    const out = [this.ternary()];
    while (this.isOp(',')) {
      this.pos++;
      out.push(this.ternary());
    }
    this.expect(')');
    return out;
  }

  /** skill('Name'.blvl), stat('name'.accr) and similar references: consumed, worth 0. */
  private reference(): number {
    this.expect('(');
    let depth = 1;
    while (depth > 0) {
      const t = this.tokens[this.pos++];
      if (!t) throw new Error(`calc: unterminated reference in ${this.src}`);
      if (t.kind === 'op' && t.value === '(') depth++;
      if (t.kind === 'op' && t.value === ')') depth--;
    }
    return 0;
  }

  private identifier(name: string): number {
    const { ctx } = this;
    const par = (n: number) => ctx.params[n - 1] ?? 0;
    const pairs: Record<string, [number, number]> = { '12': [1, 2], '34': [3, 4], '56': [5, 6], '78': [7, 8] };

    if (name === 'min' || name === 'max') {
      const values = this.args();
      return name === 'min' ? Math.min(...values) : Math.max(...values);
    }
    if (name === 'skill' || name === 'stat' || name === 'sklvl' || name === 'miss') return this.reference();
    if (name === 'lvl' || name === 'blvl') return ctx.lvl;
    if (name === 'enms') return ctx.elementalMin ?? 0;
    if (name === 'exms') return ctx.elementalMax ?? 0;
    if (name === 'toht') return 0;

    const parMatch = /^par([1-8])$/.exec(name);
    if (parMatch) return par(Number(parMatch[1]));

    const helper = /^(ln|dm)(12|34|56|78)$/.exec(name);
    if (helper) {
      const [a, b] = pairs[helper[2]!]!;
      return helper[1] === 'ln' ? linear(par(a), par(b), ctx.lvl) : diminishing(par(a), par(b), ctx.lvl);
    }
    throw new Error(`calc: unknown identifier ${name} in ${this.src}`);
  }
}

/** Evaluates a skills.txt calc expression. A bare number column also works. */
export function evalCalc(expr: string | number | undefined, ctx: CalcContext): number {
  if (expr === undefined || expr === '') return 0;
  if (typeof expr === 'number') return expr;
  return new Parser(tokenize(expr), ctx, expr).parse();
}
