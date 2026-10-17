// Cálculo numérico: derivadas en un punto, integrales definidas, límites y series.
// Dentro de estas operaciones los ángulos van siempre en radianes, como en cualquier libro de cálculo.
import { evaluate, EvalError, FreeVarError, z, type EvalContext, type Z } from './evaluate';
import type { Node } from './parser';

type Deriv = Extract<Node, { k: 'deriv' }>;
type Integral = Extract<Node, { k: 'integral' }>;
type Lim = Extract<Node, { k: 'lim' }>;
type Series = Extract<Node, { k: 'sum' }>;

const rad = (ctx: EvalContext): EvalContext => ({ ...ctx, angle: 'rad' });

// g(t) = expresión con la variable v = t
function bind(a: Node, v: string, ctx: EvalContext) {
  const c = rad(ctx);
  return (t: number): Z => evaluate(a, { ...c, vars: { ...c.vars, [v]: z(t) } });
}

function realValue(n: Node, ctx: EvalContext, what: string): number {
  const v = evaluate(n, ctx);
  if (Math.abs(v.im) > 1e-12 * Math.max(1, Math.abs(v.re))) throw new EvalError(what + ' debe ser un número real');
  return v.re;
}

// --- Derivadas (numéricas, en el punto que tenga asignado la variable) ---

export function derivativeAt(n: Deriv, ctx: EvalContext): Z {
  const x0 = ctx.vars?.[n.v];
  if (!x0) throw new FreeVarError([n.v]);
  const g = bind(n.a, n.v, ctx);
  return z(...nthDerivative(t => g(t), x0.re, n.order));
}

function nthDerivative(g: (t: number) => Z, x: number, order: number): [number, number] {
  if (order === 0) {
    const v = g(x);
    return [v.re, v.im];
  }
  // diferencias centradas con extrapolación de Richardson
  const h = 1e-3 * Math.max(1, Math.abs(x)) * Math.pow(4, order - 1);
  const d = (hh: number): [number, number] => {
    const a = nthDerivative(g, x + hh, order - 1);
    const b = nthDerivative(g, x - hh, order - 1);
    return [(a[0] - b[0]) / (2 * hh), (a[1] - b[1]) / (2 * hh)];
  };
  const d1 = d(h), d2 = d(h / 2);
  return [(4 * d2[0] - d1[0]) / 3, (4 * d2[1] - d1[1]) / 3];
}

// --- Integrales definidas: Gauss–Kronrod 7-15 adaptativo ---

const XGK = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394,
  0.586087235467691, 0.405845151377397, 0.207784955007898, 0];
const WGK = [0.022935322010529, 0.063092092629979, 0.104790010322250, 0.140653259715525,
  0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const WG = [0.129484966168870, 0.279705391489277, 0.381830050505119, 0.417959183673469];

type F = (t: number) => [number, number];

function gk15(f: F, a: number, b: number): { val: [number, number]; err: number } {
  const c = (a + b) / 2, h = (b - a) / 2;
  let kr = 0, ki = 0, gr = 0, gi = 0;
  for (let j = 0; j < 8; j++) {
    const pts = j === 7 ? [c] : [c - h * XGK[j], c + h * XGK[j]];
    for (const t of pts) {
      const [vr, vi] = f(t);
      kr += WGK[j] * vr; ki += WGK[j] * vi;
      if (j % 2 === 1) { gr += WG[(j - 1) / 2] * vr; gi += WG[(j - 1) / 2] * vi; }
    }
  }
  return { val: [kr * h, ki * h], err: Math.hypot(kr - gr, ki - gi) * Math.abs(h) };
}

function adaptive(f: F, a: number, b: number, tol: number, depth: number, budget: { n: number }): [number, number] {
  const r = gk15(f, a, b);
  budget.n -= 15;
  if (r.err <= tol || depth > 40 || budget.n <= 0) return r.val;
  const m = (a + b) / 2;
  const L = adaptive(f, a, m, tol / 2, depth + 1, budget);
  const R = adaptive(f, m, b, tol / 2, depth + 1, budget);
  return [L[0] + R[0], L[1] + R[1]];
}

export function integrate(g: (t: number) => Z, a: number, b: number): Z {
  if (a === b) return z(0);
  if (a > b) {
    const r = integrate(g, b, a);
    return z(-r.re, -r.im);
  }
  const val = (t: number): [number, number] => {
    const v = g(t);
    if (!Number.isFinite(v.re) || !Number.isFinite(v.im)) throw new EvalError('La integral diverge o la función no está definida en el intervalo');
    return [v.re, v.im];
  };
  let f: F, lo: number, hi: number;
  if (Number.isFinite(a) && Number.isFinite(b)) {
    f = val; lo = a; hi = b;
  } else if (Number.isFinite(a)) {
    // x = a + t/(1-t), t ∈ [0, 1)
    f = t => { const s = 1 - t; const [r, i] = val(a + t / s); return [r / (s * s), i / (s * s)]; };
    lo = 0; hi = 1;
  } else if (Number.isFinite(b)) {
    f = t => { const s = 1 - t; const [r, i] = val(b - t / s); return [r / (s * s), i / (s * s)]; };
    lo = 0; hi = 1;
  } else {
    // x = t/(1-t²), t ∈ (-1, 1)
    f = t => { const s = 1 - t * t; const w = (1 + t * t) / (s * s); const [r, i] = val(t / s); return [r * w, i * w]; };
    lo = -1; hi = 1;
  }
  const coarse = gk15(f, lo, hi).val;
  const tol = Math.max(1e-12, 1e-11 * Math.hypot(coarse[0], coarse[1]));
  const budget = { n: 60000 };
  const r = adaptive(f, lo, hi, tol, 0, budget);
  if (budget.n <= 0) {
    // sin converger: si el valor no se estabiliza, probablemente diverge
    const check = adaptive(f, lo, hi, tol * 1e4, 0, { n: 20000 });
    if (Math.hypot(check[0] - r[0], check[1] - r[1]) > 1e-4 * Math.max(1, Math.hypot(r[0], r[1]))) {
      throw new EvalError('La integral no converge');
    }
  }
  return z(r[0], r[1]);
}

export function integralOf(n: Integral, ctx: EvalContext): Z {
  if (!n.lo || !n.hi) throw new EvalError('Integral indefinida: solo se calcula para polinomios');
  const a = realValue(n.lo, ctx, 'El límite inferior');
  const b = realValue(n.hi, ctx, 'El límite superior');
  return integrate(bind(n.a, n.v, ctx), a, b);
}

// --- Límites ---

function snapNice(v: number): number {
  if (!Number.isFinite(v)) return v;
  if (Math.abs(v) < 1e-9) return 0;
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(v * q);
    if (Math.abs(p / q - v) < 1e-8 * Math.max(1, Math.abs(v))) return p / q;
  }
  return v;
}

function oneSided(g: (t: number) => Z, a: number, side: 1 | -1): Z {
  const xs: number[] = [];
  if (Number.isFinite(a)) {
    const s = Math.max(1, Math.abs(a));
    for (let k = 0; k <= 24; k++) xs.push(a + side * 0.1 * s * Math.pow(2, -k));
  } else {
    for (let k = 1; k <= 14; k++) xs.push(Math.sign(a) * Math.pow(10, k));
  }
  const vals: Z[] = [];
  for (const x of xs) {
    try {
      const v = g(x);
      if (Number.isFinite(v.re) && Number.isFinite(v.im)) vals.push(v);
    } catch (e) {
      if (!(e instanceof EvalError) || e instanceof FreeVarError) throw e;
    }
  }
  if (vals.length < 4) throw new EvalError('No se puede calcular el límite');
  const last = vals.slice(-4);
  // tiende a ±∞: módulo creciendo sin parar
  if (last.every((v, i) => i === 0 || Math.hypot(v.re, v.im) > 1.5 * Math.hypot(last[i - 1].re, last[i - 1].im)) &&
      Math.hypot(last[3].re, last[3].im) > 1e6) {
    if (Math.abs(last[3].im) > 1e-9 * Math.abs(last[3].re)) throw new EvalError('El límite diverge');
    return z(Math.sign(last[3].re) * Infinity);
  }
  // extrapolación de Richardson suponiendo error proporcional al paso
  const ratio = Number.isFinite(a) ? 2 : 10;
  const ext: Z[] = [];
  for (let i = 1; i < vals.length; i++) {
    ext.push(z((ratio * vals[i].re - vals[i - 1].re) / (ratio - 1), (ratio * vals[i].im - vals[i - 1].im) / (ratio - 1)));
  }
  // el par de extrapolaciones consecutivas más estable
  let best = ext[ext.length - 1], bestDiff = Infinity;
  for (let i = 1; i < ext.length; i++) {
    const d = Math.hypot(ext[i].re - ext[i - 1].re, ext[i].im - ext[i - 1].im);
    if (d < bestDiff) { bestDiff = d; best = ext[i]; }
  }
  const scale = Math.max(1, Math.hypot(best.re, best.im));
  if (bestDiff > 1e-4 * scale) throw new EvalError('El límite no existe (la función oscila o no se estabiliza)');
  return z(snapNice(best.re), snapNice(best.im));
}

export function limitOf(n: Lim, ctx: EvalContext): Z {
  const a = realValue(n.to, ctx, 'El punto del límite');
  const g = bind(n.a, n.v, ctx);
  if (!Number.isFinite(a)) return oneSided(g, a, a > 0 ? -1 : 1);
  if (n.side !== 0) return oneSided(g, a, n.side);
  // función continua en el punto: basta con sustituir
  try {
    const v = g(a);
    if (Number.isFinite(v.re) && Number.isFinite(v.im)) {
      const near = oneSided(g, a, 1);
      if (Math.hypot(near.re - v.re, near.im - v.im) < 1e-6 * Math.max(1, Math.hypot(v.re, v.im))) return v;
    }
  } catch (e) {
    if (!(e instanceof EvalError) || e instanceof FreeVarError) throw e;
  }
  const L = oneSided(g, a, -1);
  const R = oneSided(g, a, 1);
  const same = L.re === R.re && L.im === R.im ||
    Math.hypot(L.re - R.re, L.im - R.im) < 1e-6 * Math.max(1, Math.hypot(L.re, L.im));
  if (!same) {
    const f = (v: Z) => (Number.isFinite(v.re) ? String(+v.re.toPrecision(6)) : v.re > 0 ? '+∞' : '−∞');
    throw new EvalError(`El límite no existe: por la izquierda ${f(L)}, por la derecha ${f(R)}`);
  }
  return R;
}

// --- Sumatorios y productos ---

export function seriesOf(n: Series, ctx: EvalContext): Z {
  const from = realValue(n.from, ctx, 'El inicio');
  const to = realValue(n.to, ctx, 'El final');
  if (!Number.isInteger(from) || !(Number.isInteger(to) || to === Infinity)) throw new EvalError('Los límites deben ser enteros');
  const g = (k: number) => evaluate(n.a, { ...ctx, vars: { ...ctx.vars, [n.v]: z(k) } });
  if (to < from) return z(n.prod ? 1 : 0);
  if (to !== Infinity && to - from > 1_000_000) throw new EvalError('Demasiados términos');
  // En series infinitas se guardan sumas parciales para extrapolar la cola
  const CHECKS = [10_000, 20_000, 40_000];
  const last = to === Infinity ? from + CHECKS[2] - 1 : to;
  const marks: [number, number][] = [];
  let sr = 0, si = 0, cr = 0, ci = 0; // suma compensada (Kahan)
  let pr = 1, pi = 0;
  for (let k = from; k <= last; k++) {
    const t = g(k);
    if (!Number.isFinite(t.re) || !Number.isFinite(t.im)) throw new EvalError(`El término ${k} no está definido`);
    if (n.prod) {
      [pr, pi] = [pr * t.re - pi * t.im, pr * t.im + pi * t.re];
    } else {
      const yr = t.re - cr, yi = t.im - ci;
      const nr = sr + yr, ni = si + yi;
      cr = nr - sr - yr; ci = ni - si - yi;
      sr = nr; si = ni;
    }
    if (to === Infinity && CHECKS.includes(k - from + 1)) marks.push(n.prod ? [pr, pi] : [sr, si]);
  }
  if (to !== Infinity) return n.prod ? z(pr, pi) : z(sr, si);
  // S_N ≈ S − C/N^p: con N, 2N y 4N se estima el límite (Richardson/Aitken)
  const [a, b, c] = marks;
  const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
  const m1 = Math.hypot(d1[0], d1[1]), m2 = Math.hypot(d2[0], d2[1]);
  const scale = Math.max(1, Math.hypot(c[0], c[1]));
  if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) throw new EvalError('La serie no converge');
  if (m2 <= 1e-14 * scale) return z(c[0], c[1]);
  const r = m2 / m1;
  if (!(r < 0.95)) throw new EvalError('La serie no converge');
  const k = r / (1 - r);
  return z(c[0] + d2[0] * k, c[1] + d2[1] * k);
}
