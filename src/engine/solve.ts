import { evaluate, EvalError, z, type EvalContext, type Z } from './evaluate';
import { freeVars, type Node } from './parser';
import { numericReal } from './realsolve';

// --- Aritmética compleja ligera para el cálculo de raíces ---
export type C = { re: number; im: number };
export const cadd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
export const csub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
export const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cdiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const cabs = (a: C) => Math.hypot(a.re, a.im);
export const ZERO: C = { re: 0, im: 0 };

// --- Polinomios: coeficientes de menor a mayor grado ---
export type Poly = C[];
const MAX_DEGREE = 60;

function padd(a: Poly, b: Poly): Poly {
  const r: Poly = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) r.push(cadd(a[i] ?? ZERO, b[i] ?? ZERO));
  return r;
}
function pscale(a: Poly, k: C): Poly { return a.map(c => cmul(c, k)); }
function pmul(a: Poly, b: Poly): Poly {
  const r: Poly = Array.from({ length: a.length + b.length - 1 }, () => ({ ...ZERO }));
  a.forEach((x, i) => b.forEach((y, j) => { r[i + j] = cadd(r[i + j], cmul(x, y)); }));
  return r;
}
function trim(a: Poly): Poly {
  const scale = Math.max(...a.map(cabs), 0);
  let n = a.length;
  while (n > 1 && cabs(a[n - 1]) <= 1e-13 * scale) n--;
  return a.slice(0, n);
}

class NotPoly extends Error {}

// Convierte el AST en un polinomio en la variable v (o lanza NotPoly)
export function toPoly(n: Node, v: string, ctx: EvalContext): Poly {
  if (!freeVars(n).has(v)) return [evaluate(n, ctx)];
  switch (n.k) {
    case 'var': return [ZERO, { re: 1, im: 0 }];
    case 'neg': return pscale(toPoly(n.a, v, ctx), { re: -1, im: 0 });
    case 'deg': return ctx.angle === 'deg' ? toPoly(n.a, v, ctx) : pscale(toPoly(n.a, v, ctx), { re: Math.PI / 180, im: 0 });
    case 'bin': {
      const hasB = freeVars(n.b).has(v);
      switch (n.op) {
        case '+': return padd(toPoly(n.a, v, ctx), toPoly(n.b, v, ctx));
        case '-': return padd(toPoly(n.a, v, ctx), pscale(toPoly(n.b, v, ctx), { re: -1, im: 0 }));
        case '*': {
          const r = pmul(toPoly(n.a, v, ctx), toPoly(n.b, v, ctx));
          if (r.length - 1 > MAX_DEGREE) throw new NotPoly();
          return r;
        }
        case '/': {
          if (hasB) throw new NotPoly();
          const d = evaluate(n.b, ctx);
          if (d.re === 0 && d.im === 0) throw new EvalError('División entre cero');
          return toPoly(n.a, v, ctx).map(c => cdiv(c, d));
        }
        case '^': {
          if (hasB) throw new NotPoly();
          const e = evaluate(n.b, ctx);
          if (e.im !== 0 || !Number.isInteger(e.re) || e.re < 0 || e.re > MAX_DEGREE) throw new NotPoly();
          const base = toPoly(n.a, v, ctx);
          let r: Poly = [{ re: 1, im: 0 }];
          for (let i = 0; i < e.re; i++) r = pmul(r, base);
          if (r.length - 1 > MAX_DEGREE) throw new NotPoly();
          return r;
        }
      }
      throw new NotPoly();
    }
  }
  throw new NotPoly();
}

export function tryPoly(n: Node, v: string, ctx: EvalContext): Poly | null {
  try {
    return trim(toPoly(n, v, ctx));
  } catch (e) {
    if (e instanceof NotPoly) return null;
    throw e;
  }
}

function horner(p: Poly, x: C): C {
  let r = ZERO;
  for (let i = p.length - 1; i >= 0; i--) r = cadd(cmul(r, x), p[i]);
  return r;
}
function deriv(p: Poly): Poly {
  return p.slice(1).map((c, i) => cmul(c, { re: i + 1, im: 0 }));
}

// Método de Aberth–Ehrlich: todas las raíces complejas a la vez
export function polyRoots(p: Poly): C[] {
  const n = p.length - 1;
  if (n === 1) return [cdiv({ re: -p[0].re, im: -p[0].im }, p[1])];
  if (n === 2) {
    const [c, b, a] = p;
    const disc = csub(cmul(b, b), cmul({ re: 4, im: 0 }, cmul(a, c)));
    const r = Math.sqrt(cabs(disc));
    const th = Math.atan2(disc.im, disc.re) / 2;
    let s: C = { re: r * Math.cos(th), im: r * Math.sin(th) };
    // fórmula estable: evita cancelaciones
    if (b.re * s.re + b.im * s.im < 0) s = { re: -s.re, im: -s.im };
    const q = cmul({ re: -0.5, im: 0 }, cadd(b, s));
    if (cabs(q) === 0) return [ZERO, ZERO];
    return [cdiv(q, a), cdiv(c, q)];
  }
  const lead = p[n];
  const monic = p.map(c => cdiv(c, lead));
  const dp = deriv(monic);
  const radius = 1 + Math.max(...monic.slice(0, n).map(cabs));
  let roots: C[] = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n + 0.4;
    return { re: radius * 0.5 * Math.cos(a), im: radius * 0.5 * Math.sin(a) };
  });
  for (let iter = 0; iter < 500; iter++) {
    let maxStep = 0;
    roots = roots.map((r, i) => {
      const ratio = cdiv(horner(monic, r), horner(dp, r));
      let sum = ZERO;
      roots.forEach((s, j) => { if (j !== i) sum = cadd(sum, cdiv({ re: 1, im: 0 }, csub(r, s))); });
      const w = cdiv(ratio, csub({ re: 1, im: 0 }, cmul(ratio, sum)));
      if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) return r;
      maxStep = Math.max(maxStep, cabs(w) / Math.max(1, cabs(r)));
      return csub(r, w);
    });
    if (maxStep < 1e-15) break;
  }
  return roots;
}

export function cleanRoot(r: C): C {
  const s = Math.max(1, cabs(r));
  return {
    re: Math.abs(r.re) < 1e-10 * s ? 0 : r.re,
    im: Math.abs(r.im) < 1e-9 * s ? 0 : r.im,
  };
}

function sortRoots(rs: C[]): C[] {
  return rs.sort((a, b) => {
    const ar = a.im === 0, br = b.im === 0;
    if (ar !== br) return ar ? -1 : 1;
    return a.re - b.re || a.im - b.im;
  });
}

export interface Solution {
  roots: Z[];
  mult?: number[];
  note?: string;
  identity?: boolean;
}

export function solveEquation(lhs: Node, rhs: Node, v: string, ctx: EvalContext): Solution {
  const f: Node = { k: 'bin', op: '-', a: lhs, b: rhs };
  const p = tryPoly(f, v, ctx);
  if (p) {
    if (p.length === 1) {
      return cabs(p[0]) < 1e-12 ? { roots: [], identity: true } : { roots: [], note: 'La ecuación no tiene solución' };
    }
    return rootsWithMultiplicity(p);
  }
  return numericReal(f, v, ctx);
}

// Raíces de un polinomio agrupadas con su multiplicidad
export function rootsWithMultiplicity(p: Poly): { roots: Z[]; mult: number[] } {
  // Las raíces múltiples convergen mal; su centroide en cambio es muy preciso
  const raw = polyRoots(p);
  const groups: C[][] = [];
  for (const r of raw) {
    const g = groups.find(g => cabs(csub(g[0], r)) < 1e-4 * Math.max(1, cabs(r)));
    if (g) g.push(r); else groups.push([r]);
  }
  const uniq = groups.map(g => ({
    r: cleanRoot({ re: g.reduce((s, c) => s + c.re, 0) / g.length, im: g.reduce((s, c) => s + c.im, 0) / g.length }),
    mult: g.length,
  }));
  const order = sortRoots(uniq.map(u => u.r));
  return {
    roots: order.map(r => z(r.re, r.im)),
    mult: order.map(r => uniq.find(u => u.r === r)!.mult),
  };
}

