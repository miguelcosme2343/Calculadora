import type { Z } from './evaluate';

export type Notation = 'auto' | 'fixed' | 'sci' | 'eng';

export interface Settings {
  notation: Notation;
  sig: number; // cifras significativas (auto, científica, ingeniería)
  decimals: number; // decimales en notación fija
  engPrefix: boolean; // 4.7 k en lugar de 4.7×10³
  complexForm: 'rect' | 'polar';
  angle: 'deg' | 'rad';
  imagUnit: 'i' | 'j';
  fractions: boolean;
  decimalComma: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  notation: 'auto',
  sig: 6,
  decimals: 3,
  engPrefix: true,
  complexForm: 'polar',
  angle: 'deg',
  imagUnit: 'j',
  fractions: true,
  decimalComma: false,
};

export interface Formatted {
  latex: string;
  text: string;
  label?: string;
}

const PREFIXES: Record<number, string> = {
  [-18]: 'a', [-15]: 'f', [-12]: 'p', [-9]: 'n', [-6]: 'µ', [-3]: 'm',
  3: 'k', 6: 'M', 9: 'G', 12: 'T', 15: 'P',
};

const trimZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

function sepd(f: Formatted, s: Settings): Formatted {
  if (!s.decimalComma) return f;
  return { ...f, latex: f.latex.replace(/(\d)\.(\d)/g, '$1{,}$2'), text: f.text.replace(/(\d)\.(\d)/g, '$1,$2') };
}

function plain(x: number, sig: number): string {
  const e = Math.floor(Math.log10(Math.abs(x)));
  const d = Math.min(20, Math.max(0, sig - 1 - e));
  let s = trimZeros(x.toFixed(d));
  if (s === '-0') s = '0';
  return s;
}

function mantExp(x: number, sig: number, step: 1 | 3): [string, number] {
  let e = Math.floor(Math.log10(Math.abs(x)));
  e = Math.floor(e / step) * step;
  let mant = x / Math.pow(10, e);
  let d = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(mant))));
  let ms = mant.toFixed(Math.min(20, d));
  // el redondeo puede llevar la mantisa a 10 (o a 1000)
  if (Math.abs(Number(ms)) >= Math.pow(10, step)) {
    e += step;
    mant = x / Math.pow(10, e);
    d = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(mant))));
    ms = mant.toFixed(Math.min(20, d));
  }
  return [trimZeros(ms), e];
}

function withExp(m: string, e: number): Formatted {
  if (e === 0) return { latex: m, text: m };
  return { latex: `${m}\\times10^{${e}}`, text: `${m}e${e}` };
}

// Número real según una notación concreta
export function formatReal(x: number, s: Settings, notation: Notation = s.notation): Formatted {
  if (Number.isNaN(x)) return { latex: '\\text{indefinido}', text: 'indefinido' };
  if (!Number.isFinite(x)) return { latex: x > 0 ? '\\infty' : '-\\infty', text: x > 0 ? '∞' : '-∞' };
  if (x === 0) {
    const zero = notation === 'fixed' && s.decimals > 0 ? '0.' + '0'.repeat(s.decimals) : '0';
    return sepd({ latex: zero, text: zero }, s);
  }
  let f: Formatted;
  const ax = Math.abs(x);
  switch (notation) {
    case 'fixed': {
      if (ax >= 1e21) return formatReal(x, s, 'sci');
      const t = x.toFixed(s.decimals);
      f = { latex: t, text: t };
      break;
    }
    case 'sci':
      f = withExp(...mantExp(x, s.sig, 1));
      break;
    case 'eng': {
      const [m, e] = mantExp(x, s.sig, 3);
      if (s.engPrefix && e !== 0 && PREFIXES[e]) {
        const p = PREFIXES[e];
        f = { latex: `${m}\\,\\mathrm{${p === 'µ' ? '\\mu' : p}}`, text: `${m} ${p}` };
      } else f = withExp(m, e);
      break;
    }
    default:
      f = ax >= 1e-4 && ax < 1e10
        ? { latex: plain(x, s.sig), text: plain(x, s.sig) }
        : withExp(...mantExp(x, s.sig, 1));
  }
  return sepd(f, s);
}

// Fracción continua: p/q con q ≤ maxDen que reproduce x casi exactamente
export function rational(x: number, maxDen = 10000): [number, number] | null {
  if (!Number.isFinite(x) || Number.isInteger(x) || Math.abs(x) > 1e9) return null;
  let h0 = 1, h1 = 0, k0 = 0, k1 = 1;
  let b = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    [h0, h1] = [a * h0 + h1, h0];
    [k0, k1] = [a * k0 + k1, k0];
    if (k0 > maxDen) return null;
    if (Math.abs(h0 / k0 - x) <= 1e-12 * Math.max(1, Math.abs(x))) return k0 === 1 ? null : [h0, k0];
    const frac = b - a;
    if (frac < 1e-15) return null;
    b = 1 / frac;
  }
  return null;
}

function fraction(x: number): Formatted | null {
  const r = rational(x);
  if (r) {
    const [p, q] = r;
    const sign = p < 0 ? '-' : '';
    return { latex: `${sign}\\frac{${Math.abs(p)}}{${q}}`, text: `${p}/${q}`, label: 'Fracción' };
  }
  // múltiplos sencillos de π
  if (Math.abs(x) < 1e-12) return null;
  const y = x / Math.PI;
  const rp = Math.abs(y - Math.round(y)) < 1e-12 ? [Math.round(y), 1] : rational(y, 12);
  if (rp && rp[0] !== 0 && Math.abs(rp[0]) <= 100) {
    const [p, q] = rp;
    const sign = p < 0 ? '-' : '';
    const n = Math.abs(p) === 1 ? '\\pi' : `${Math.abs(p)}\\pi`;
    const nt = Math.abs(p) === 1 ? 'π' : `${Math.abs(p)}π`;
    return q === 1
      ? { latex: sign + n, text: sign + nt, label: 'Con π' }
      : { latex: `${sign}\\frac{${n}}{${q}}`, text: `${sign}${nt}/${q}`, label: 'Con π' };
  }
  return null;
}

function cleanZ(v: Z): { re: number; im: number } {
  const mag = Math.hypot(v.re, v.im);
  if (!Number.isFinite(mag)) return { re: v.re, im: Number.isFinite(v.im) ? 0 : v.im };
  const tol = 1e-12 * mag;
  return { re: Math.abs(v.re) <= tol ? 0 : v.re, im: Math.abs(v.im) <= tol ? 0 : v.im };
}

export function isRealValue(v: Z): boolean {
  return cleanZ(v).im === 0;
}

function rect(re: number, im: number, s: Settings, notation: Notation): Formatted {
  const u = s.imagUnit;
  const imPart = (b: number): Formatted => {
    const f = formatReal(Math.abs(b), s, notation);
    const one = Math.abs(b) === 1 && notation !== 'fixed';
    if (u === 'j') return one ? { latex: 'j', text: 'j' } : { latex: `j${f.latex}`, text: `j${f.text}` };
    return one ? { latex: 'i', text: 'i' } : { latex: `${f.latex}i`, text: `${f.text}i` };
  };
  const b = imPart(im);
  if (re === 0) return { latex: (im < 0 ? '-' : '') + b.latex, text: (im < 0 ? '-' : '') + b.text };
  const a = formatReal(re, s, notation);
  const op = im < 0 ? '-' : '+';
  return { latex: `${a.latex}${op}${b.latex}`, text: `${a.text} ${op} ${b.text}` };
}

function polar(re: number, im: number, s: Settings, notation: Notation, angle = s.angle): Formatted {
  const r = formatReal(Math.hypot(re, im), s, notation);
  let th = Math.atan2(im, re);
  if (angle === 'deg') th *= 180 / Math.PI;
  const t = formatReal(th, s, notation === 'eng' ? 'auto' : notation);
  return angle === 'deg'
    ? { latex: `${r.latex}\\angle${t.latex}^{\\circ}`, text: `${r.text}∠${t.text}°` }
    : { latex: `${r.latex}\\angle${t.latex}`, text: `${r.text}∠${t.text}` };
}

// Forma principal según los ajustes
export function formatValue(v: Z, s: Settings): Formatted {
  const { re, im } = cleanZ(v);
  if (im === 0) {
    if (s.fractions && s.notation === 'auto') {
      const fr = fraction(re);
      if (fr) return sepd(fr, s);
    }
    return formatReal(re, s);
  }
  return s.complexForm === 'polar' ? polar(re, im, s, s.notation) : rect(re, im, s, s.notation);
}

// Otras formas del mismo resultado, sin repetir la principal
export function alternatives(v: Z, s: Settings): Formatted[] {
  const { re, im } = cleanZ(v);
  const main = formatValue(v, s).text;
  const out: Formatted[] = [];
  const add = (f: Formatted | null, label: string) => {
    if (f && f.text !== main && !out.some(o => o.text === f.text)) out.push({ ...f, label: f.label ?? label });
  };
  if (im === 0) {
    add(formatReal(re, s, 'auto'), 'Decimal');
    add(fraction(re) && sepd(fraction(re)!, s), 'Fracción');
    if (Math.abs(re) >= 1000 || (Math.abs(re) < 0.01 && re !== 0)) {
      add(formatReal(re, s, 'eng'), 'Ingeniería');
      add(formatReal(re, s, 'sci'), 'Científica');
    }
    if (re < 0) add(polar(re, 0, s, s.notation), 'Polar');
  } else {
    add(rect(re, im, s, s.notation), 'Rectangular');
    add(polar(re, im, s, s.notation), 'Polar');
    add(polar(re, im, s, s.notation, s.angle === 'deg' ? 'rad' : 'deg'), s.angle === 'deg' ? 'Polar (rad)' : 'Polar (°)');
  }
  return out;
}

export function varLatex(name: string): string {
  const [base, sub] = name.split('_');
  const b = base.length > 1 ? '\\' + base : base;
  return sub ? `${b}_{${sub}}` : b;
}

// Polinomio expandido, de mayor a menor grado
export function formatPoly(coeffs: Z[], variable: string, s: Settings): Formatted {
  const x = varLatex(variable);
  let latex = '';
  let text = '';
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const { re, im } = cleanZ(coeffs[i]);
    if (re === 0 && im === 0) continue;
    const pow = i === 0 ? '' : i === 1 ? x : `${x}^{${i}}`;
    const powT = i === 0 ? '' : i === 1 ? variable : `${variable}^${i}`;
    let cl: string, ct: string, neg = false;
    if (im === 0) {
      neg = re < 0;
      const f = s.fractions ? fraction(Math.abs(re)) ?? formatReal(Math.abs(re), s) : formatReal(Math.abs(re), s);
      cl = f.latex; ct = f.text;
      if (Math.abs(re) === 1 && i > 0) { cl = ''; ct = ''; }
    } else {
      const f = rect(re, im, s, s.notation);
      cl = `\\left(${f.latex}\\right)`; ct = `(${f.text})`;
    }
    if (latex) { latex += neg ? '-' : '+'; text += neg ? ' - ' : ' + '; }
    else if (neg) { latex += '-'; text += '-'; }
    latex += cl + pow;
    text += ct + (ct && powT ? '·' : '') + powT;
  }
  return sepd({ latex: latex || '0', text: text || '0' }, s);
}

function realOut(x: number, s: Settings): Formatted {
  if (s.fractions && s.notation === 'auto') {
    const f = fraction(x);
    if (f) return sepd(f, s);
  }
  return formatReal(x, s);
}

// Solución de una desigualdad en notación de intervalos
export function formatIntervals(iv: { lo: number; hi: number; loClosed: boolean; hiClosed: boolean }[], variable: string, s: Settings): Formatted {
  const x = varLatex(variable);
  if (iv.length === 0) return { latex: '\\text{Sin solución}', text: 'Sin solución' };
  if (iv.length === 1 && iv[0].lo === -Infinity && iv[0].hi === Infinity) {
    return { latex: `${x}\\in\\mathbb{R}`, text: `${variable} ∈ ℝ` };
  }
  const parts = iv.map(i => {
    if (i.lo === i.hi) {
      const p = realOut(i.lo, s);
      return { latex: `\\left\\lbrace${p.latex}\\right\\rbrace`, text: `{${p.text}}` };
    }
    const lo = realOut(i.lo, s), hi = realOut(i.hi, s);
    const sep = s.decimalComma ? ';' : ',';
    return {
      latex: `${i.loClosed ? '\\left[' : '\\left('}${lo.latex}${sep}${hi.latex}${i.hiClosed ? '\\right]' : '\\right)'}`,
      text: `${i.loClosed ? '[' : '('}${lo.text}${sep} ${hi.text}${i.hiClosed ? ']' : ')'}`,
    };
  });
  return {
    latex: `${x}\\in${parts.map(p => p.latex).join('\\cup')}`,
    text: `${variable} ∈ ${parts.map(p => p.text).join(' ∪ ')}`,
  };
}

export interface Form extends Formatted {
  label: string;
  patch?: Partial<Settings>; // ajustes que hacen de esta forma la predeterminada
}

function piForm(x: number): Formatted | null {
  if (Math.abs(x) < 1e-12) return null;
  const y = x / Math.PI;
  const r = Math.abs(y - Math.round(y)) < 1e-12 ? [Math.round(y), 1] : rational(y, 12);
  if (!r || r[0] === 0 || Math.abs(r[0]) > 100) return null;
  const [p, q] = r;
  const sign = p < 0 ? '-' : '';
  const n = Math.abs(p) === 1 ? '\\pi' : `${Math.abs(p)}\\pi`;
  const nt = Math.abs(p) === 1 ? 'π' : `${Math.abs(p)}π`;
  return q === 1 ? { latex: sign + n, text: sign + nt } : { latex: `${sign}\\frac{${n}}{${q}}`, text: `${sign}${nt}/${q}` };
}

// Todas las formas de un resultado, para el panel de soluciones
export function allForms(v: Z, s: Settings): Form[] {
  const { re, im } = cleanZ(v);
  const out: Form[] = [];
  const add = (label: string, f: Formatted | null, patch?: Partial<Settings>) => {
    if (f && !out.some(o => o.text === f.text && o.label === label)) out.push({ ...f, label, patch });
  };
  if (im === 0) {
    const r = rational(re);
    add('Decimal', formatReal(re, s, 'auto'), { notation: 'auto', fractions: false });
    if (r) add('Fracción', sepd({ latex: `${r[0] < 0 ? '-' : ''}\\frac{${Math.abs(r[0])}}{${r[1]}}`, text: `${r[0]}/${r[1]}` }, s), { notation: 'auto', fractions: true });
    add('Con π', piForm(re) && sepd(piForm(re)!, s), { notation: 'auto', fractions: true });
    add('Alta precisión', formatReal(re, { ...s, sig: 15 }, 'auto'));
    add('Científica', formatReal(re, s, 'sci'), { notation: 'sci' });
    add('Ingeniería', formatReal(re, { ...s, engPrefix: false }, 'eng'), { notation: 'eng', engPrefix: false });
    add('Prefijo SI', formatReal(re, { ...s, engPrefix: true }, 'eng'), { notation: 'eng', engPrefix: true });
    add(`${s.decimals} decimales`, formatReal(re, s, 'fixed'), { notation: 'fixed' });
    if (re < 0) add('Polar', polar(re, 0, s, s.notation));
    return out;
  }
  const n = s.notation;
  const mod = Math.hypot(re, im), th = Math.atan2(im, re);
  add('Rectangular', rect(re, im, s, n), { complexForm: 'rect' });
  add('Polar (grados)', polar(re, im, s, n, 'deg'), { complexForm: 'polar' });
  add('Polar (radianes)', polar(re, im, s, n, 'rad'));
  const r = formatReal(mod, s, n), t = formatReal(th, s, n === 'eng' ? 'auto' : n);
  add('Exponencial', { latex: `${r.latex}\\,e^{${s.imagUnit}${t.latex}}`, text: `${r.text}·e^(${s.imagUnit}${t.text})` });
  add('Módulo', formatReal(mod, s, n));
  const deg = formatReal((th * 180) / Math.PI, s, n === 'eng' ? 'auto' : n);
  add('Argumento', { latex: `${deg.latex}^{\\circ}=${t.latex}\\,\\mathrm{rad}`, text: `${deg.text}° = ${t.text} rad` });
  add('Parte real', formatReal(re, s, n));
  add('Parte imaginaria', formatReal(im, s, n));
  add('Conjugado', rect(re, -im, s, n));
  return out;
}

// ¿Esta forma es la que se muestra ahora por defecto?
export function isDefaultForm(f: Form, s: Settings): boolean {
  if (!f.patch) return false;
  return Object.entries(f.patch).every(([k, v]) => (s as unknown as Record<string, unknown>)[k] === v);
}

// Matriz con cada elemento en el formato elegido
export function formatMatrix(M: { rows: number; cols: number; a: { re: number; im: number }[][] }, s: Settings): Formatted {
  const cells = M.a.map(r => r.map(c => formatValue(c as unknown as Z, s)));
  return {
    latex: '\\begin{pmatrix}' + cells.map(r => r.map(c => c.latex).join('&')).join('\\\\') + '\\end{pmatrix}',
    text: '[' + cells.map(r => '[' + r.map(c => c.text).join(', ') + ']').join(', ') + ']',
  };
}
