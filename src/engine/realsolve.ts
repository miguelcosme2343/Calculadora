// Funciones reales cualesquiera (muestreo + bisección), desigualdades y sistemas de ecuaciones.
import { evaluate, EvalError, FreeVarError, z, type EvalContext, type Z } from './evaluate';
import { freeVars, type Node, type RelOp } from './parser';
import {
  cabs, cadd, cdiv, cleanRoot, cmul, csub, polyRoots, tryPoly, ZERO,
  type C, type Poly, type Solution,
} from './solve';

const RANGE = 1e4;
let samples: number[] | null = null;
function sampleGrid(): number[] {
  if (samples) return samples;
  const xs: number[] = [];
  for (let i = -4000; i <= 4000; i++) xs.push(i / 200); // [-20, 20] fino
  for (let i = 1; i <= 3000; i++) {
    const x = 20 * Math.pow(RANGE / 20, i / 3000);
    xs.push(x, -x);
  }
  return (samples = xs.sort((a, b) => a - b));
}

// f real de variable real; NaN donde no está definida o da un complejo
function realFn(f: Node, v: string, ctx: EvalContext) {
  const state = { complexSeen: false };
  const g = (x: number): number => {
    try {
      const r = evaluate(f, { ...ctx, vars: { ...ctx.vars, [v]: z(x) } });
      if (Math.abs(r.im) > 1e-9 * Math.max(1, Math.abs(r.re))) { state.complexSeen = true; return NaN; }
      return r.re;
    } catch (e) {
      if (e instanceof EvalError && !(e instanceof FreeVarError)) return NaN;
      throw e;
    }
  };
  return { g, state };
}

interface Scan { roots: number[]; poles: number[]; edges: number[] }

function scanReal(g: (x: number) => number): Scan {
  const xs = sampleGrid();
  const ys = xs.map(g);
  const roots: number[] = [], poles: number[] = [], edges: number[] = [];
  const add = (arr: number[], x: number) => {
    if (Math.abs(x) < 1e-12) x = 0;
    if (!arr.some(r => Math.abs(r - x) <= 1e-8 * Math.max(1, Math.abs(x)))) arr.push(x);
  };
  for (let k = 0; k < xs.length; k++) {
    const y = ys[k];
    if (y === 0) { add(roots, xs[k]); continue; }
    if (k === 0) continue;
    const yp = ys[k - 1];
    // borde del dominio: definida a un lado y no al otro
    if (Number.isFinite(y) !== Number.isFinite(yp)) {
      let a = xs[k - 1], b = xs[k];
      const defA = Number.isFinite(yp);
      for (let it = 0; it < 80; it++) {
        const mid = (a + b) / 2;
        if (Number.isFinite(g(mid)) === defA) a = mid; else b = mid;
      }
      const edge = defA ? a : b;
      add(edges, edge);
      if (Math.abs(g(edge)) < 1e-7) add(roots, edge);
      continue;
    }
    if (!Number.isFinite(y)) continue;
    if (Math.sign(y) !== Math.sign(yp) && yp !== 0) {
      let a = xs[k - 1], b = xs[k], fa = yp;
      for (let it = 0; it < 200 && b - a > 1e-15 * Math.max(1, Math.abs(a)); it++) {
        const mid = (a + b) / 2;
        const fm = g(mid);
        if (!Number.isFinite(fm)) break;
        if (Math.sign(fm) === Math.sign(fa)) { a = mid; fa = fm; } else b = mid;
      }
      const r = (a + b) / 2;
      const fr = Math.abs(g(r));
      // un polo también cambia de signo, pero con valores enormes
      if (fr < 1e-6 && fr <= Math.min(Math.abs(yp), Math.abs(y))) add(roots, r);
      else add(poles, r);
    } else if (k + 1 < xs.length && Number.isFinite(ys[k + 1])) {
      // raíz doble: mínimo local de |f| cerca de 0
      const ay = Math.abs(y);
      if (ay < Math.abs(yp) && ay < Math.abs(ys[k + 1]) && ay < 1e-2) {
        let a = xs[k - 1], b = xs[k + 1];
        for (let it = 0; it < 200; it++) {
          const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
          if (Math.abs(g(m1)) < Math.abs(g(m2))) b = m2; else a = m1;
        }
        const r = (a + b) / 2;
        if (Math.abs(g(r)) < 1e-10) add(roots, r);
      }
    }
  }
  const sort = (a: number[]) => a.sort((p, q) => p - q);
  return { roots: sort(roots), poles: sort(poles), edges: sort(edges) };
}

export function numericReal(f: Node, v: string, ctx: EvalContext): Solution {
  const { g, state } = realFn(f, v, ctx);
  const found = scanReal(g).roots;
  let note = 'Soluciones reales buscadas en [−10⁴, 10⁴]';
  let roots = found;
  if (found.length > 12) {
    roots = [...found].sort((a, b) => Math.abs(a) - Math.abs(b)).slice(0, 12).sort((a, b) => a - b);
    note = `Hay ${found.length} soluciones en [−10⁴, 10⁴]; se muestran las 12 más cercanas a 0`;
  }
  if (roots.length === 0) note = state.complexSeen ? 'No se encontraron soluciones reales' : 'No se encontraron soluciones en [−10⁴, 10⁴]';
  return { roots: roots.map(r => z(Math.abs(r) < 1e-12 ? 0 : r)), note };
}

// --- Desigualdades con una incógnita ---

export interface Interval { lo: number; hi: number; loClosed: boolean; hiClosed: boolean }

export function solveInequality(op: RelOp, lhs: Node, rhs: Node, v: string, ctx: EvalContext): Interval[] {
  const f: Node = { k: 'bin', op: '-', a: lhs, b: rhs };
  const { g } = realFn(f, v, ctx);
  let breaks: number[];
  let roots: number[];
  const p = tryPoly(f, v, ctx);
  if (p && p.every(c => Math.abs(c.im) < 1e-12 * Math.max(1, cabs(c)))) {
    const rs = p.length > 1 ? polyRoots(p).map(cleanRoot).filter(r => r.im === 0).map(r => r.re) : [];
    roots = [...new Set(rs.map(r => +r.toPrecision(14)))].sort((a, b) => a - b);
    breaks = roots;
  } else {
    const s = scanReal(g);
    roots = s.roots;
    breaks = [...new Set([...s.roots, ...s.poles, ...s.edges])].sort((a, b) => a - b);
  }
  const holds = (y: number) =>
    Number.isFinite(y) && (op === '<' ? y < 0 : op === '>' ? y > 0 : op === '<=' ? y <= 1e-12 : y >= -1e-12);
  const closed = op === '<=' || op === '>=';
  const isRoot = (x: number) => closed && roots.includes(x) && Number.isFinite(g(x));
  // un punto de prueba dentro de cada tramo entre cortes
  const pts = [-Infinity, ...breaks, Infinity];
  const out: Interval[] = [];
  const push = (iv: Interval) => {
    const last = out[out.length - 1];
    if (last && last.hi === iv.lo && (last.hiClosed || iv.loClosed)) {
      last.hi = iv.hi;
      last.hiClosed = iv.hiClosed;
    } else out.push(iv);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const mid = !Number.isFinite(a) && !Number.isFinite(b) ? 0
      : !Number.isFinite(a) ? b - 1 - Math.abs(b)
      : !Number.isFinite(b) ? a + 1 + Math.abs(a)
      : (a + b) / 2;
    const inside = holds(g(mid));
    if (Number.isFinite(a) && isRoot(a)) push({ lo: a, hi: a, loClosed: true, hiClosed: true });
    if (inside) push({ lo: a, hi: b, loClosed: false, hiClosed: false });
  }
  return out;
}

// --- Sistemas de ecuaciones ---

export interface SystemSolution {
  vars: string[];
  solutions: Z[][];
  linear: boolean;
  note?: string;
}

// Generador pseudoaleatorio determinista para los puntos de partida
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

export function solveSystem(eqs: Node[], ctx: EvalContext): SystemSolution {
  if (eqs.some(e => e.k !== 'eq')) throw new EvalError('En un sistema todas las líneas deben ser ecuaciones');
  const vars = [...new Set(eqs.flatMap(e => [...freeVars(e)]))].filter(n => !ctx.vars?.[n]).sort();
  const n = vars.length, m = eqs.length;
  if (n === 0) throw new EvalError('El sistema no tiene incógnitas');
  const fs: Node[] = eqs.map(e => (e.k === 'eq' ? { k: 'bin', op: '-', a: e.a, b: e.b } : e));
  const F = (x: C[]): C[] => {
    const vs: Record<string, Z> = { ...ctx.vars };
    vars.forEach((name, i) => { vs[name] = z(x[i].re, x[i].im); });
    return fs.map(f => {
      const r = evaluate(f, { ...ctx, vars: vs });
      return { re: r.re, im: r.im };
    });
  };

  // ¿Es lineal? F(x) = A·x + c, comprobado en dos puntos al azar
  const lin = (() => {
    try {
      const zero = vars.map(() => ({ ...ZERO }));
      const c = F(zero);
      const cols = vars.map((_, j) => F(zero.map((_, k) => ({ re: k === j ? 1 : 0, im: 0 }))).map((v, i) => csub(v, c[i])));
      const rand = rng(7);
      for (let t = 0; t < 2; t++) {
        const x = vars.map(() => ({ re: rand() * 6 - 3, im: rand() * 2 - 1 }));
        const fx = F(x);
        for (let i = 0; i < m; i++) {
          let pred = c[i];
          for (let j = 0; j < n; j++) pred = cadd(pred, cmul(cols[j][i], x[j]));
          if (cabs(csub(pred, fx[i])) > 1e-8 * Math.max(1, cabs(fx[i]), cabs(pred))) return null;
        }
      }
      return { cols, c };
    } catch (e) {
      if (e instanceof EvalError && !(e instanceof FreeVarError)) return null;
      throw e;
    }
  })();

  if (lin) return solveLinear(vars, lin.cols, lin.c);
  if (m !== n) throw new EvalError(`Hay ${n} incógnitas (${vars.join(', ')}) y ${m} ecuaciones`);
  return newtonSystem(vars, F);
}

// Eliminación de Gauss–Jordan con pivoteo parcial, en complejos
function solveLinear(vars: string[], cols: C[][], c: C[]): SystemSolution {
  const n = vars.length, m = c.length;
  const M = c.map((ci, i) => [...vars.map((_, j) => ({ ...cols[j][i] })), { re: -ci.re, im: -ci.im }]);
  const scale = Math.max(1, ...M.flat().map(cabs));
  let row = 0;
  const pivCols: number[] = [];
  for (let col = 0; col < n && row < m; col++) {
    let best = row;
    for (let r = row + 1; r < m; r++) if (cabs(M[r][col]) > cabs(M[best][col])) best = r;
    if (cabs(M[best][col]) < 1e-12 * scale) continue;
    [M[row], M[best]] = [M[best], M[row]];
    const pv = M[row][col];
    for (let k = col; k <= n; k++) M[row][k] = cdiv(M[row][k], pv);
    for (let r = 0; r < m; r++) {
      if (r === row) continue;
      const f = M[r][col];
      if (cabs(f) === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] = csub(M[r][k], cmul(f, M[row][k]));
    }
    pivCols.push(col);
    row++;
  }
  for (let r = row; r < m; r++) {
    if (cabs(M[r][n]) > 1e-9 * scale) return { vars, solutions: [], linear: true, note: 'El sistema no tiene solución (incompatible)' };
  }
  if (pivCols.length < n) return { vars, solutions: [], linear: true, note: 'El sistema tiene infinitas soluciones (indeterminado)' };
  const sol = vars.map((_, j) => cleanRoot(M[pivCols.indexOf(j)][n]));
  return { vars, solutions: [sol.map(s => z(s.re, s.im))], linear: true };
}

// Newton–Raphson amortiguado desde varios puntos de partida (soluciones reales)
function newtonSystem(vars: string[], F: (x: C[]) => C[]): SystemSolution {
  const n = vars.length;
  const rand = rng(12345);
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, c) => s + c * c, 0));
  const safeF = (x: number[]): number[] | null => {
    try {
      const r = F(x.map(re => ({ re, im: 0 })));
      if (r.some(c => !Number.isFinite(c.re) || Math.abs(c.im) > 1e-9 * Math.max(1, Math.abs(c.re)))) return null;
      return r.map(c => c.re);
    } catch (e) {
      if (e instanceof EvalError && !(e instanceof FreeVarError)) return null;
      throw e;
    }
  };
  const found: number[][] = [];
  const starts: number[][] = [vars.map(() => 0.5), vars.map(() => 1), vars.map(() => -1)];
  for (let s = 0; s < 60; s++) starts.push(vars.map(() => (rand() * 2 - 1) * (s < 30 ? 3 : 20)));
  for (const x0 of starts) {
    let x = [...x0];
    let fx = safeF(x);
    for (let it = 0; it < 60 && fx; it++) {
      const fn = norm(fx);
      if (fn < 1e-12) break;
      const J: number[][] = fx.map(() => new Array(n).fill(0));
      let ok = true;
      for (let j = 0; j < n && ok; j++) {
        const h = 1e-7 * Math.max(1, Math.abs(x[j]));
        const xp = [...x]; xp[j] += h;
        const xm = [...x]; xm[j] -= h;
        const fp = safeF(xp), fm = safeF(xm);
        if (!fp || !fm) { ok = false; break; }
        for (let i = 0; i < n; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
      }
      if (!ok) break;
      const dx = solveReal(J, fx.map(v => -v));
      if (!dx) break;
      // paso amortiguado: se reduce mientras no mejore
      let t = 1, next: number[] | null = null, fnext: number[] | null = null;
      for (let k = 0; k < 20; k++) {
        const cand = x.map((xi, i) => xi + t * dx[i]);
        const fc = safeF(cand);
        if (fc && norm(fc) < fn) { next = cand; fnext = fc; break; }
        t /= 2;
      }
      if (!next) break;
      x = next;
      fx = fnext;
    }
    if (!fx || norm(fx) > 1e-9 * Math.max(1, ...x.map(Math.abs))) continue;
    const clean = x.map(v => (Math.abs(v) < 1e-11 ? 0 : +v.toPrecision(12)));
    if (!found.some(f => f.every((v, i) => Math.abs(v - clean[i]) <= 1e-7 * Math.max(1, Math.abs(v))))) found.push(clean);
    if (found.length >= 12) break;
  }
  found.sort((a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  return {
    vars,
    solutions: found.map(s => s.map(v => z(v))),
    linear: false,
    note: found.length ? 'Sistema no lineal: soluciones reales halladas numéricamente' : 'No se encontraron soluciones reales',
  };
}

function solveReal(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}

// Integral indefinida de un polinomio (sin la constante)
export function integratePoly(p: Poly): Poly {
  return [{ ...ZERO }, ...p.map((c, i) => cdiv(c, { re: i + 1, im: 0 }))];
}
