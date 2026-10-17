// Matrices de números complejos: operaciones, determinante, inversa, rango y valores propios.
import { applyFn, binOp, evaluate, EvalError, z, type EvalContext, type Z } from './evaluate';
import { contains, type Node } from './parser';
import { cabs, cadd, cdiv, cmul, csub, rootsWithMultiplicity, ZERO, type C } from './solve';

export interface Mat { rows: number; cols: number; a: C[][] }
export type Val = Z | Mat;

export const isMat = (v: Val): v is Mat => (v as Mat).a !== undefined;

// ¿Hay alguna matriz dentro? (se guarda para no recorrer el árbol en cada evaluación)
const cache = new WeakMap<Node, boolean>();
export function hasMatrix(n: Node): boolean {
  let r = cache.get(n);
  if (r === undefined) {
    r = contains(n, x => x.k === 'matrix');
    cache.set(n, r);
  }
  return r;
}

const ONE: C = { re: 1, im: 0 };
const toC = (v: Z): C => ({ re: v.re, im: v.im });
const mat = (rows: number, cols: number, f: (i: number, j: number) => C): Mat => ({
  rows, cols, a: Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => f(i, j))),
});
export const identity = (n: number) => mat(n, n, (i, j) => (i === j ? { ...ONE } : { ...ZERO }));

function scalarOf(v: Val, what: string): Z {
  if (isMat(v)) {
    if (v.rows === 1 && v.cols === 1) return z(v.a[0][0].re, v.a[0][0].im);
    throw new EvalError(what);
  }
  return v;
}

function matOf(v: Val, what: string): Mat {
  if (!isMat(v)) throw new EvalError(what);
  return v;
}

function sameSize(A: Mat, B: Mat, op: string) {
  if (A.rows !== B.rows || A.cols !== B.cols) {
    throw new EvalError(`No se puede ${op} una matriz ${A.rows}×${A.cols} con una ${B.rows}×${B.cols}`);
  }
}

export function mmul(A: Mat, B: Mat): Mat {
  if (A.cols !== B.rows) throw new EvalError(`No se pueden multiplicar: ${A.rows}×${A.cols} por ${B.rows}×${B.cols} (las columnas de la primera deben coincidir con las filas de la segunda)`);
  return mat(A.rows, B.cols, (i, j) => {
    let s = { ...ZERO };
    for (let k = 0; k < A.cols; k++) s = cadd(s, cmul(A.a[i][k], B.a[k][j]));
    return s;
  });
}

const mscale = (A: Mat, k: C) => mat(A.rows, A.cols, (i, j) => cmul(A.a[i][j], k));
export const transpose = (A: Mat) => mat(A.cols, A.rows, (i, j) => A.a[j][i]);

function requireSquare(A: Mat, what: string) {
  if (A.rows !== A.cols) throw new EvalError(`${what} solo existe para matrices cuadradas (esta es ${A.rows}×${A.cols})`);
}

const scaleOf = (A: Mat) => Math.max(1e-300, ...A.a.flat().map(cabs));

// Determinante por eliminación con pivoteo parcial
export function det(A: Mat): C {
  requireSquare(A, 'El determinante');
  const n = A.rows;
  const M = A.a.map(r => r.map(c => ({ ...c })));
  let d: C = { ...ONE };
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (cabs(M[r][c]) > cabs(M[p][c])) p = r;
    if (cabs(M[p][c]) === 0) return { ...ZERO };
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; d = { re: -d.re, im: -d.im }; }
    d = cmul(d, M[c][c]);
    for (let r = c + 1; r < n; r++) {
      const f = cdiv(M[r][c], M[c][c]);
      for (let k = c; k < n; k++) M[r][k] = csub(M[r][k], cmul(f, M[c][k]));
    }
  }
  // limpia el ruido de redondeo (p. ej. matrices singulares que dan 1e-16)
  const tol = 1e-12 * Math.pow(scaleOf(A), n);
  return { re: Math.abs(d.re) < tol ? 0 : d.re, im: Math.abs(d.im) < tol ? 0 : d.im };
}

// Inversa por Gauss–Jordan
export function inverse(A: Mat): Mat {
  requireSquare(A, 'La inversa');
  const n = A.rows;
  const M = A.a.map((r, i) => [...r.map(c => ({ ...c })), ...identity(n).a[i]]);
  const tol = 1e-12 * scaleOf(A);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (cabs(M[r][c]) > cabs(M[p][c])) p = r;
    if (cabs(M[p][c]) <= tol) throw new EvalError('La matriz no tiene inversa (su determinante es 0)');
    [M[p], M[c]] = [M[c], M[p]];
    const pv = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] = cdiv(M[c][k], pv);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (cabs(f) === 0) continue;
      for (let k = 0; k < 2 * n; k++) M[r][k] = csub(M[r][k], cmul(f, M[c][k]));
    }
  }
  return clean(mat(n, n, (i, j) => M[i][n + j]));
}

export function rank(A: Mat): number {
  const M = A.a.map(r => r.map(c => ({ ...c })));
  const tol = 1e-10 * scaleOf(A);
  let row = 0;
  for (let c = 0; c < A.cols && row < A.rows; c++) {
    let p = row;
    for (let r = row + 1; r < A.rows; r++) if (cabs(M[r][c]) > cabs(M[p][c])) p = r;
    if (cabs(M[p][c]) <= tol) continue;
    [M[p], M[row]] = [M[row], M[p]];
    for (let r = row + 1; r < A.rows; r++) {
      const f = cdiv(M[r][c], M[row][c]);
      for (let k = c; k < A.cols; k++) M[r][k] = csub(M[r][k], cmul(f, M[row][k]));
    }
    row++;
  }
  return row;
}

export function trace(A: Mat): C {
  requireSquare(A, 'La traza');
  let s = { ...ZERO };
  for (let i = 0; i < A.rows; i++) s = cadd(s, A.a[i][i]);
  return s;
}

// Polinomio característico det(λI − A) por Faddeev–LeVerrier (coeficientes de menor a mayor grado)
export function charPoly(A: Mat): C[] {
  requireSquare(A, 'El polinomio característico');
  const n = A.rows;
  const c: C[] = new Array(n + 1).fill(null).map(() => ({ ...ZERO }));
  c[n] = { ...ONE };
  let M = mat(n, n, () => ({ ...ZERO }));
  for (let k = 1; k <= n; k++) {
    const AM = mmul(A, M);
    M = mat(n, n, (i, j) => (i === j ? cadd(AM.a[i][j], c[n - k + 1]) : AM.a[i][j]));
    const t = trace(mmul(A, M));
    c[n - k] = { re: -t.re / k, im: -t.im / k };
  }
  return c;
}

function clean(A: Mat): Mat {
  const tol = 1e-12 * scaleOf(A);
  return mat(A.rows, A.cols, (i, j) => {
    const v = A.a[i][j];
    return { re: Math.abs(v.re) < tol ? 0 : v.re, im: Math.abs(v.im) < tol ? 0 : v.im };
  });
}

function mpow(A: Mat, e: Z): Mat {
  requireSquare(A, 'La potencia');
  if (Math.abs(e.im) > 1e-12 || !Number.isInteger(e.re)) throw new EvalError('Una matriz solo se puede elevar a un entero');
  let n = Math.abs(e.re);
  let base = e.re < 0 ? inverse(A) : A;
  let r = identity(A.rows);
  while (n > 0) {
    if (n & 1) r = mmul(r, base);
    base = mmul(base, base);
    n >>= 1;
  }
  return clean(r);
}

const MAT_ONLY = 'Esta operación necesita una matriz';

// Evalúa una expresión que puede dar una matriz o un número
export function evalValue(n: Node, ctx: EvalContext): Val {
  if (!hasMatrix(n)) return evaluate(n, ctx);
  switch (n.k) {
    case 'matrix':
      return mat(n.rows.length, n.rows[0].length, (i, j) => toC(scalarOf(evalValue(n.rows[i][j], ctx), 'Una matriz no puede contener otra matriz')));
    case 'neg': {
      const a = evalValue(n.a, ctx);
      return isMat(a) ? mscale(a, { re: -1, im: 0 }) : z(-a.re, -a.im);
    }
    case 'bin': {
      const a = evalValue(n.a, ctx);
      const b = evalValue(n.b, ctx);
      // p. ej. det(A) + 1: los dos lados ya son números
      if (!isMat(a) && !isMat(b)) return binOp(n.op, a, b, ctx);
      switch (n.op) {
        case '+': case '-': {
          if (!isMat(a) || !isMat(b)) throw new EvalError(`No se puede ${n.op === '+' ? 'sumar' : 'restar'} un número y una matriz`);
          sameSize(a, b, n.op === '+' ? 'sumar' : 'restar');
          return mat(a.rows, a.cols, (i, j) => (n.op === '+' ? cadd : csub)(a.a[i][j], b.a[i][j]));
        }
        case '*': {
          if (isMat(a) && isMat(b)) return mmul(a, b);
          return isMat(a) ? mscale(a, toC(b as Z)) : mscale(b as Mat, toC(a));
        }
        case '/': {
          if (isMat(b)) throw new EvalError('No se puede dividir entre una matriz (multiplica por su inversa: A^{-1})');
          return mscale(a as Mat, cdiv(ONE, toC(b)));
        }
        case '^': {
          if (isMat(b)) throw new EvalError('El exponente no puede ser una matriz');
          return mpow(matOf(a, MAT_ONLY), b);
        }
      }
      throw new EvalError('Operación no válida con matrices');
    }
    case 'fn': {
      const a = evalValue(n.args[0], ctx);
      switch (n.name) {
        case 'det': case 'abs': {
          if (!isMat(a)) return n.name === 'abs' ? z(Math.hypot(a.re, a.im)) : a;
          const d = det(a);
          return z(d.re, d.im);
        }
        case 'trace': { const t = trace(matOf(a, MAT_ONLY)); return z(t.re, t.im); }
        case 'rank': return z(rank(matOf(a, MAT_ONLY)));
        case 'transpose': return isMat(a) ? transpose(a) : a;
        case 'inv': return isMat(a) ? inverse(a) : evaluate({ k: 'bin', op: '/', a: { k: 'num', v: 1 }, b: n.args[0] }, ctx);
        case 'conj': return isMat(a) ? mat(a.rows, a.cols, (i, j) => ({ re: a.a[i][j].re, im: -a.a[i][j].im })) : z(a.re, -a.im);
      }
      if (isMat(a)) throw new EvalError(`La función ${n.name} no se aplica a matrices`);
      const rest = n.args.slice(1).map(x => scalarOf(evalValue(x, ctx), `La función ${n.name} no se aplica a matrices`));
      return applyFn(n.name, [a, ...rest], ctx);
    }
  }
  throw new EvalError('Aquí no puede ir una matriz');
}

// Para el evaluador escalar: funciones de matriz que dan un número (det, traza, rango…)
export function scalarValue(n: Node, ctx: EvalContext): Z {
  return scalarOf(evalValue(n, ctx), 'El resultado es una matriz; aquí se esperaba un número');
}

// Propiedades para el panel de soluciones
export interface MatrixInfo {
  det?: Z;
  trace?: Z;
  rank: number;
  inverse?: Mat;
  inverseError?: string;
  transpose: Mat;
  eigen?: { roots: Z[]; mult: number[] };
}

export function matrixInfo(A: Mat): MatrixInfo {
  const info: MatrixInfo = { rank: rank(A), transpose: transpose(A) };
  if (A.rows !== A.cols) return info;
  const d = det(A), t = trace(A);
  info.det = z(d.re, d.im);
  info.trace = z(t.re, t.im);
  try {
    info.inverse = inverse(A);
  } catch (e) {
    info.inverseError = (e as Error).message;
  }
  if (A.rows <= 12) {
    const p = charPoly(A);
    if (p.length > 1) info.eigen = rootsWithMultiplicity(p);
  }
  return info;
}
