import { evaluate, EvalError, FreeVarError, z, type EvalContext, type Z } from './evaluate';
import { contains, freeVars, parseLatex, ParseError, type Node } from './parser';
import { integratePoly, solveInequality, solveSystem, type Interval, type SystemSolution } from './realsolve';
import { solveEquation, tryPoly } from './solve';
import { NotSymbolic, symbolic, texOf, textOf } from './symbolic';
import { varLatex } from './format';
import { evalValue, hasMatrix, isMat, type Mat } from './matrix';

export type Result = (
  | { kind: 'empty' }
  | { kind: 'incomplete' }
  | { kind: 'error'; message: string }
  | { kind: 'value'; value: Z; ast: Node }
  | { kind: 'matrix'; value: Mat; ast: Node }
  | { kind: 'bool'; value: boolean }
  | { kind: 'poly'; variable: string; coeffs: Z[]; ast: Node; antiderivative?: boolean }
  | { kind: 'symbolic'; latex: string; text: string; vars: string[]; ast: Node }
  | { kind: 'function'; vars: string[]; name?: string; body: Node }
  | { kind: 'needsVars'; names: string[] }
  | { kind: 'inequality'; variable: string; intervals: Interval[]; ast: Node }
  | ({ kind: 'system'; ast: Node } & SystemSolution)
  | {
      kind: 'solutions'; variable: string; roots: Z[]; mult?: number[]; note?: string; identity?: boolean;
      lhs: Node; rhs: Node;
    }
) & { note?: string };

export interface CalcOptions extends EvalContext {
  imagUnit?: 'i' | 'j';
}

const FN_NAMES = new Set(['f', 'g', 'h', 'F', 'G', 'H', 'y', 'z']);
const CALCULUS = (n: Node) => n.k === 'deriv' || n.k === 'integral' || n.k === 'lim';
const TRIG = (n: Node) => n.k === 'fn' && /^(a?(sin|cos|tan|sec|csc|cot)h?)$/.test(n.name);

// f(x) = …, y = …, z = … (con x e y): definición de función para graficar
function functionDefinition(a: Node, b: Node): { name: string; vars: string[] } | null {
  const rhsVars = [...freeVars(b)];
  if (a.k === 'var' && (a.name === 'y' || a.name === 'z')) {
    const allowed = a.name === 'y' ? ['x'] : ['x', 'y'];
    if (rhsVars.length > 0 && rhsVars.every(v => allowed.includes(v))) {
      return { name: a.name, vars: a.name === 'y' ? ['x'] : rhsVars.length === 2 ? ['x', 'y'] : rhsVars };
    }
    return null;
  }
  if (a.k === 'bin' && a.op === '*' && a.a.k === 'var' && FN_NAMES.has(a.a.name)) {
    const args = a.b.k === 'var' ? [a.b] : a.b.k === 'tuple' ? a.b.items : null;
    if (!args || !args.every(x => x.k === 'var') || args.length > 2) return null;
    const vars = args.map(x => (x as { name: string }).name);
    if (!rhsVars.every(v => vars.includes(v))) return null;
    return { name: a.a.name, vars };
  }
  return null;
}

export function calculate(latex: string, ctx: CalcOptions): Result {
  if (!latex.trim()) return { kind: 'empty' };
  try {
    const ast = parseLatex(latex);
    const note = ctx.angle === 'deg' && contains(ast, CALCULUS) && contains(ast, TRIG)
      ? 'En derivadas, integrales y límites los ángulos van en radianes'
      : undefined;
    const r = solve(ast, ctx);
    return note && r.kind !== 'error' ? { ...r, note: r.note ?? note } : r;
  } catch (e) {
    if (e instanceof ParseError) return e.incomplete ? { kind: 'incomplete' } : { kind: 'error', message: e.message };
    if (e instanceof FreeVarError) return { kind: 'needsVars', names: e.names };
    if (e instanceof EvalError) return { kind: 'error', message: e.message };
    throw e;
  }
}

function solve(ast: Node, ctx: CalcOptions): Result {
  const names = [...freeVars(ast)].filter(n => !ctx.vars?.[n]);

  if (ast.k === 'system') return { kind: 'system', ast, ...solveSystem(ast.eqs, ctx) };
  if (ast.k === 'tuple') return { kind: 'error', message: 'Lista de valores fuera de lugar' };

  if (hasMatrix(ast)) {
    if (ast.k === 'eq' || ast.k === 'rel') {
      return { kind: 'error', message: 'Las ecuaciones con matrices aún no están soportadas' };
    }
    if (names.length) return { kind: 'error', message: 'Las matrices solo admiten números (sin incógnitas)' };
    const v = evalValue(ast, ctx);
    return isMat(v) ? { kind: 'matrix', value: v, ast } : { kind: 'value', value: v, ast };
  }

  if (ast.k === 'eq') {
    const def = functionDefinition(ast.a, ast.b);
    if (def) return { kind: 'function', name: def.name, vars: def.vars, body: ast.b };
    if (names.length === 0) {
      const a = evaluate(ast.a, ctx);
      const b = evaluate(ast.b, ctx);
      const tol = 1e-10 * Math.max(1, Math.hypot(a.re, a.im), Math.hypot(b.re, b.im));
      return { kind: 'bool', value: Math.hypot(a.re - b.re, a.im - b.im) <= tol };
    }
    if (names.length > 1) {
      return { kind: 'error', message: `Hay varias incógnitas (${names.join(', ')}): escribe un sistema con ↵` };
    }
    return { kind: 'solutions', variable: names[0], lhs: ast.a, rhs: ast.b, ...solveEquation(ast.a, ast.b, names[0], ctx) };
  }

  if (ast.k === 'rel') {
    if (names.length === 0) {
      const a = evaluate(ast.a, ctx), b = evaluate(ast.b, ctx);
      if (Math.abs(a.im) > 1e-12 || Math.abs(b.im) > 1e-12) throw new EvalError('Los números complejos no se pueden comparar');
      const d = a.re - b.re;
      const ok = ast.op === '<' ? d < 0 : ast.op === '>' ? d > 0 : ast.op === '<=' ? d <= 1e-12 : d >= -1e-12;
      return { kind: 'bool', value: ok };
    }
    if (names.length > 1) return { kind: 'error', message: 'Las desigualdades solo admiten una incógnita' };
    return { kind: 'inequality', variable: names[0], intervals: solveInequality(ast.op, ast.a, ast.b, names[0], ctx), ast };
  }

  // Integral indefinida: solo de polinomios
  if (ast.k === 'integral' && !ast.lo) {
    const others = names.filter(n => n !== ast.v);
    if (others.length) return { kind: 'needsVars', names: others };
    const p = tryPoly(ast.a, ast.v, ctx);
    if (!p) return { kind: 'error', message: 'Las integrales indefinidas solo se resuelven para polinomios; prueba con límites de integración' };
    const P = integratePoly(p);
    return { kind: 'poly', variable: ast.v, coeffs: P.map(c => z(c.re, c.im)), ast, antiderivative: true };
  }

  if (names.length === 0) return { kind: 'value', value: evaluate(ast, ctx), ast };

  if (contains(ast, n => n.k === 'deriv')) {
    try {
      const s = symbolic(ast, ctx);
      return { kind: 'symbolic', latex: texOf(s, ctx.imagUnit ?? 'i', varLatex), text: textOf(s), vars: names, ast };
    } catch (e) {
      if (!(e instanceof NotSymbolic)) throw e;
      if (names.length <= 2) return { kind: 'function', vars: names, body: ast };
      throw new EvalError('No se puede derivar simbólicamente esta expresión');
    }
  }

  if (names.length === 1) {
    const p = tryPoly(ast, names[0], ctx);
    if (p && p.length > 1) return { kind: 'poly', variable: names[0], coeffs: p.map(c => z(c.re, c.im)), ast };
    return { kind: 'function', vars: names, body: ast };
  }
  if (names.length === 2) return { kind: 'function', vars: names.sort(), body: ast };
  return { kind: 'needsVars', names };
}

// Función numérica real para graficar: (x[, y]) → valor (NaN si no está definida)
export function compile(body: Node, vars: string[], ctx: EvalContext): (...args: number[]) => Z | null {
  return (...args: number[]) => {
    const vs: Record<string, Z> = { ...ctx.vars };
    vars.forEach((v, i) => { vs[v] = z(args[i]); });
    try {
      return evaluate(body, { ...ctx, vars: vs });
    } catch (e) {
      if (e instanceof EvalError && !(e instanceof FreeVarError)) return null;
      throw e;
    }
  };
}

export type { Z } from './evaluate';
export type { Node } from './parser';
export type { Interval } from './realsolve';
export type { Mat } from './matrix';
export { matrixInfo } from './matrix';
export * from './format';
