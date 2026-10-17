import * as m from 'mathjs';
import type { Complex } from 'mathjs';
import type { Node } from './parser';
import { derivativeAt, integralOf, limitOf, seriesOf } from './calculus';
import { hasMatrix, scalarValue } from './matrix';

export type Z = Complex;
export type AngleUnit = 'deg' | 'rad';

export interface EvalContext {
  angle: AngleUnit;
  vars?: Record<string, Z>;
  ans?: Z | null;
}

export class EvalError extends Error {}
export class FreeVarError extends EvalError {
  constructor(readonly names: string[]) {
    super('Variables sin valor: ' + names.join(', '));
  }
}

export const z = (re: number, im = 0): Z => m.complex(re, im);
const Z0 = z(0);
const Z1 = z(1);

const isReal = (a: Z) => a.im === 0 || Math.abs(a.im) <= 1e-14 * Math.max(1, Math.abs(a.re));
const realOf = (a: Z) => a.re;
const wrap = (v: unknown): Z => m.complex(v as Complex);
const call = (f: (x: Z) => unknown) => (x: Z): Z => wrap(f(x));

// Valores muy pequeños causados por redondeo (p. ej. sin(180°) = 1.2e-16) se llevan a 0
function snap(v: number, scale: number): number {
  return Math.abs(v) < 1e-14 * Math.max(1, Math.abs(scale)) ? 0 : v;
}

function toRad(a: Z, ctx: EvalContext): Z {
  return ctx.angle === 'deg' ? m.multiply(a, Math.PI / 180) as Z : a;
}
function fromRad(a: Z, ctx: EvalContext): Z {
  return ctx.angle === 'deg' ? m.multiply(a, 180 / Math.PI) as Z : a;
}

function sinZ(x: Z): Z {
  if (isReal(x)) return z(snap(Math.sin(x.re), x.re));
  return call(m.sin)(x);
}
function cosZ(x: Z): Z {
  if (isReal(x)) return z(snap(Math.cos(x.re), x.re));
  return call(m.cos)(x);
}
function tanZ(x: Z): Z {
  if (isReal(x)) {
    const c = snap(Math.cos(x.re), x.re);
    if (c === 0) throw new EvalError('Tangente no definida en ese ángulo');
    return z(snap(Math.sin(x.re), x.re) / c);
  }
  return call(m.tan)(x);
}

function div(a: Z, b: Z): Z {
  if (b.re === 0 && b.im === 0) throw new EvalError('División entre cero');
  return wrap(m.divide(a, b));
}

// Si q tiene denominador pequeño, devuelve [p, q]
function smallFraction(x: number, maxDen = 64): [number, number] | null {
  for (let q = 1; q <= maxDen; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-12) return [p, q];
  }
  return null;
}

function powZ(a: Z, b: Z): Z {
  if (isReal(a) && isReal(b)) {
    const x = a.re, y = b.re;
    if (x === 0 && y < 0) throw new EvalError('División entre cero');
    if (x >= 0 || Number.isInteger(y)) return z(Math.pow(x, y));
    // Base negativa con exponente racional de denominador impar → raíz real, como en una calculadora
    const f = smallFraction(y);
    if (f && f[1] % 2 === 1) {
      const r = Math.pow(-x, y);
      return z(f[0] % 2 === 0 ? r : -r);
    }
  }
  if (a.re === 0 && a.im === 0) return isReal(b) && b.re > 0 ? Z0 : wrap(m.pow(a, b));
  return wrap(m.pow(a, b));
}

function rootZ(n: Z, x: Z): Z {
  if (!isReal(n)) return powZ(x, div(Z1, n));
  const k = n.re;
  if (k === 0) throw new EvalError('Raíz de índice 0');
  if (isReal(x) && Number.isInteger(k) && Math.abs(k) % 2 === 1) {
    const r = Math.pow(Math.abs(x.re), 1 / k);
    return z(x.re < 0 ? -r : r);
  }
  return powZ(x, z(1 / k));
}

function factZ(x: Z): Z {
  if (isReal(x) && Number.isInteger(x.re)) {
    if (x.re < 0) throw new EvalError('Factorial de un entero negativo');
    if (x.re > 170) return z(Infinity);
    let r = 1;
    for (let i = 2; i <= x.re; i++) r *= i;
    return z(r);
  }
  return wrap(m.gamma(m.add(x, 1) as Complex));
}

function logZ(x: Z): Z {
  if (x.re === 0 && x.im === 0) throw new EvalError('Logaritmo de cero');
  if (isReal(x) && x.re > 0) return z(Math.log(x.re));
  return wrap(m.log(x));
}

const ROUNDERS: Record<string, (v: number) => number> = { floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign };

function fn(name: string, args: Z[], ctx: EvalContext): Z {
  const [x, y] = args;
  switch (name) {
    case 'sin': return sinZ(toRad(x, ctx));
    case 'cos': return cosZ(toRad(x, ctx));
    case 'tan': return tanZ(toRad(x, ctx));
    case 'sec': return div(Z1, cosZ(toRad(x, ctx)));
    case 'csc': return div(Z1, sinZ(toRad(x, ctx)));
    case 'cot': return div(cosZ(toRad(x, ctx)), sinZ(toRad(x, ctx)));
    case 'asin': return fromRad(isReal(x) && Math.abs(x.re) <= 1 ? z(Math.asin(x.re)) : call(m.asin)(x), ctx);
    case 'acos': return fromRad(isReal(x) && Math.abs(x.re) <= 1 ? z(Math.acos(x.re)) : call(m.acos)(x), ctx);
    case 'atan': return fromRad(isReal(x) ? z(Math.atan(x.re)) : call(m.atan)(x), ctx);
    case 'acot': return x.re === 0 && x.im === 0 ? fromRad(z(Math.PI / 2), ctx) : fn('atan', [div(Z1, x)], ctx);
    case 'asec': return fn('acos', [div(Z1, x)], ctx);
    case 'acsc': return fn('asin', [div(Z1, x)], ctx);
    case 'sinh': return isReal(x) ? z(Math.sinh(x.re)) : call(m.sinh)(x);
    case 'cosh': return isReal(x) ? z(Math.cosh(x.re)) : call(m.cosh)(x);
    case 'tanh': return isReal(x) ? z(Math.tanh(x.re)) : call(m.tanh)(x);
    case 'coth': return div(Z1, fn('tanh', [x], ctx));
    case 'sech': return div(Z1, fn('cosh', [x], ctx));
    case 'csch': return div(Z1, fn('sinh', [x], ctx));
    case 'asinh': return isReal(x) ? z(Math.asinh(x.re)) : call(m.asinh)(x);
    case 'acosh': return isReal(x) && x.re >= 1 ? z(Math.acosh(x.re)) : call(m.acosh)(x);
    case 'atanh': return isReal(x) && Math.abs(x.re) < 1 ? z(Math.atanh(x.re)) : call(m.atanh)(x);
    case 'acoth': return fn('atanh', [div(Z1, x)], ctx);
    case 'asech': return fn('acosh', [div(Z1, x)], ctx);
    case 'acsch': return fn('asinh', [div(Z1, x)], ctx);
    case 'ln': return logZ(x);
    case 'log': return div(logZ(x), z(Math.LN10));
    case 'logb': return div(logZ(y), logZ(x));
    case 'exp': return isReal(x) ? z(Math.exp(x.re)) : call(m.exp)(x);
    case 'sqrt': return isReal(x) && x.re >= 0 ? z(Math.sqrt(x.re)) : call(m.sqrt)(x);
    case 'root': return rootZ(x, y);
    case 'abs': return z(Math.hypot(x.re, x.im));
    case 'arg': return fromRad(z(Math.atan2(x.im, x.re)), ctx);
    case 're': return z(x.re);
    case 'im': return z(x.im);
    case 'conj': return z(x.re, -x.im);
    case 'fact': return factZ(x);
    // funciones de matriz aplicadas a un número (matriz 1×1)
    case 'det': case 'trace': case 'transpose': return x;
    case 'inv': return div(Z1, x);
    case 'rank': return z(x.re === 0 && x.im === 0 ? 0 : 1);
  }
  if (ROUNDERS[name]) {
    if (!isReal(x)) throw new EvalError(name + ' solo admite números reales');
    return z(ROUNDERS[name](x.re));
  }
  throw new EvalError('Función desconocida: ' + name);
}

// Operación binaria entre números (la usa también el evaluador de matrices)
export function binOp(op: Extract<Node, { k: 'bin' }>['op'], a: Z, b: Z, ctx: EvalContext): Z {
  switch (op) {
    case '+': return wrap(m.add(a, b));
    case '-': return wrap(m.subtract(a, b));
    case '*': return wrap(m.multiply(a, b));
    case '/': return div(a, b);
    case '^': return powZ(a, b);
    case 'par': {
      // Z1 ∥ Z2 = Z1·Z2 / (Z1 + Z2)
      const s = wrap(m.add(a, b));
      if (s.re === 0 && s.im === 0) throw new EvalError('Paralelo no definido (Z₁ + Z₂ = 0)');
      return div(wrap(m.multiply(a, b)), s);
    }
    case 'angle': {
      // r∠θ = r·(cos θ + i·sin θ)
      const th = toRad(b, ctx);
      return wrap(m.multiply(a, m.complex(cosZ(th).re - sinZ(th).im, sinZ(th).re + cosZ(th).im)));
    }
  }
}

export { fn as applyFn };

export function evaluate(n: Node, ctx: EvalContext): Z {
  // det, traza, rango… y cualquier expresión con matrices que dé un número
  if (n.k !== 'num' && n.k !== 'var' && n.k !== 'const' && hasMatrix(n)) return scalarValue(n, ctx);
  switch (n.k) {
    case 'matrix': throw new EvalError('Aquí no puede ir una matriz');
    case 'num': return z(n.v);
    case 'const':
      return n.name === 'pi' ? z(Math.PI) : n.name === 'e' ? z(Math.E) : z(0, 1);
    case 'var': {
      const v = ctx.vars?.[n.name];
      if (!v) throw new FreeVarError([n.name]);
      return v;
    }
    case 'ans':
      if (!ctx.ans) throw new EvalError('Todavía no hay un resultado anterior (Ans)');
      return ctx.ans;
    case 'neg': {
      const a = evaluate(n.a, ctx);
      return z(-a.re, -a.im);
    }
    case 'deg': {
      const a = evaluate(n.a, ctx);
      return ctx.angle === 'deg' ? a : wrap(m.multiply(a, Math.PI / 180));
    }
    case 'radu': {
      const a = evaluate(n.a, ctx);
      return ctx.angle === 'rad' ? a : wrap(m.multiply(a, 180 / Math.PI));
    }
    case 'eq': case 'rel': case 'system': throw new EvalError('Aquí no puede ir una ecuación');
    case 'tuple': throw new EvalError('Lista de valores fuera de lugar');
    case 'deriv': return derivativeAt(n, ctx);
    case 'integral': return integralOf(n, ctx);
    case 'lim': return limitOf(n, ctx);
    case 'sum': return seriesOf(n, ctx);
    case 'fn': return fn(n.name, n.args.map(a => evaluate(a, ctx)), ctx);
    case 'bin': return binOp(n.op, evaluate(n.a, ctx), evaluate(n.b, ctx), ctx);
  }
}

export { isReal, realOf, div };
