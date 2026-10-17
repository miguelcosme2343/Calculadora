import { describe, expect, it } from 'vitest';
import { calculate, DEFAULT_SETTINGS, formatIntervals, formatPoly, formatValue, type Result } from './index';

const S = { ...DEFAULT_SETTINGS, complexForm: 'rect' as const };
const ctx = { angle: 'deg' as const, imagUnit: 'j' as const };

function value(latex: string, angle: 'deg' | 'rad' = 'deg'): string {
  const r = calculate(latex, { ...ctx, angle });
  if (r.kind !== 'value') throw new Error(`${latex} → ${JSON.stringify(r)}`);
  return formatValue(r.value, S).text;
}
function kind<K extends Result['kind']>(latex: string, k: K): Extract<Result, { kind: K }> {
  const r = calculate(latex, ctx);
  if (r.kind !== k) throw new Error(`${latex} → ${JSON.stringify(r)}`);
  return r as Extract<Result, { kind: K }>;
}

describe('funciones trigonométricas ampliadas', () => {
  it('recíprocas e inversas', () => {
    expect(value('\\sec\\left(60\\right)')).toBe('2');
    expect(value('\\operatorname{arcsec}\\left(2\\right)')).toBe('60');
    expect(value('\\operatorname{arccot}\\left(1\\right)')).toBe('45');
    expect(value('\\coth\\left(1\\right)')).toBe('1.31304');
    expect(value('\\operatorname{arsech}\\left(0.5\\right)')).toBe('1.31696');
    expect(value('\\cot^{-1}\\left(1\\right)')).toBe('45');
  });
  it('rad y grados', () => {
    expect(value('\\sin\\left(\\frac{\\pi}{2}\\mathrm{rad}\\right)')).toBe('1');
    expect(value('\\sin\\left(90\\degree\\right)', 'rad')).toBe('1');
  });
});

describe('cálculo', () => {
  it('derivadas simbólicas', () => {
    const r = kind('\\frac{d}{dx}x^3', 'symbolic');
    expect(r.text.replace(/\s/g, '')).toBe('3*x^2');
    const s = kind('\\frac{d}{dx}\\left(\\sin\\left(x\\right)\\right)', 'symbolic');
    expect(s.text.replace(/\s/g, '')).toBe('cos(x)');
    const t = kind('\\frac{d^2}{dx^2}x^4', 'symbolic');
    expect(t.text.replace(/\s/g, '')).toBe('12*x^2');
  });
  it('integrales definidas', () => {
    expect(value('\\int_0^1x^2\\,dx')).toBe('1/3');
    expect(value('\\int_{0}^{\\pi}\\sin\\left(x\\right)\\mathrm{d}x')).toBe('2');
    expect(value('\\int_{0}^{\\infty}e^{-x}dx')).toBe('1');
    expect(value('\\int_{-\\infty}^{\\infty}e^{-x^2}dx', 'rad')).toBe('1.77245');
  });
  it('integral indefinida de un polinomio', () => {
    const r = kind('\\int3x^2+2x\\,dx', 'poly');
    expect(r.antiderivative).toBe(true);
    expect(formatPoly(r.coeffs, r.variable, S).text).toBe('x^3 + x^2');
  });
  it('límites', () => {
    expect(value('\\lim_{x\\to0}\\frac{\\sin\\left(x\\right)}{x}')).toBe('1');
    expect(value('\\lim_{x\\to\\infty}\\left(1+\\frac{1}{x}\\right)^x')).toBe('2.71828');
    expect(value('\\lim_{x\\to2}x^2')).toBe('4');
    expect(value('\\lim_{x\\to0^{+}}\\frac{1}{x}')).toBe('∞');
    expect(calculate('\\lim_{x\\to0}\\frac{1}{x}', ctx)).toMatchObject({ kind: 'error' });
    expect(value('\\lim_{x\\to1}\\frac{x^2-1}{x-1}')).toBe('2');
  });
  it('series', () => {
    expect(value('\\sum_{n=1}^{10}n')).toBe('55');
    expect(value('\\sum_{n=1}^{\\infty}\\frac{1}{n^2}', 'rad')).toBe('1.64493');
    expect(value('\\sum_{n=0}^{\\infty}\\frac{1}{2^n}')).toBe('2');
    expect(calculate('\\sum_{n=1}^{\\infty}\\frac{1}{n}', ctx)).toMatchObject({ kind: 'error' });
    expect(value('\\prod_{k=1}^{5}k')).toBe('120');
  });
});

describe('sistemas', () => {
  it('lineal real', () => {
    const r = kind('\\begin{cases}x+y=3\\\\x-y=1\\end{cases}', 'system');
    expect(r.vars).toEqual(['x', 'y']);
    expect(r.solutions[0].map(v => formatValue(v, S).text)).toEqual(['2', '1']);
  });
  it('lineal con impedancias complejas (mallas)', () => {
    const r = kind('\\begin{cases}\\left(2+j\\right)I_1-I_2=10\\\\-I_1+\\left(3-2j\\right)I_2=0\\end{cases}', 'system');
    expect(r.vars).toEqual(['I_1', 'I_2']);
    const [i1, i2] = r.solutions[0];
    // comprobación: sustituir en la primera ecuación
    const lhs = { re: 2 * i1.re - i1.im - i2.re, im: 2 * i1.im + i1.re - i2.im };
    expect(lhs.re).toBeCloseTo(10, 9);
    expect(lhs.im).toBeCloseTo(0, 9);
  });
  it('incompatible e indeterminado', () => {
    expect(kind('\\begin{cases}x+y=1\\\\x+y=2\\end{cases}', 'system').note).toMatch(/no tiene solución/);
    expect(kind('\\begin{cases}x+y=1\\\\2x+2y=2\\end{cases}', 'system').note).toMatch(/infinitas/);
  });
  it('no lineal', () => {
    const r = kind('\\begin{cases}x^2+y^2=25\\\\x-y=1\\end{cases}', 'system');
    const sols = r.solutions.map(s => s.map(v => formatValue(v, S).text).join(','));
    expect(sols).toEqual(['-3,-4', '4,3']);
  });
  it('tres incógnitas', () => {
    const r = kind('\\begin{cases}x+y+z=6\\\\x-y=0\\\\2z=6\\end{cases}', 'system');
    expect(r.solutions[0].map(v => formatValue(v, S).text)).toEqual(['3/2', '3/2', '3']);
  });
});

describe('desigualdades', () => {
  const iv = (latex: string) => {
    const r = kind(latex, 'inequality');
    return formatIntervals(r.intervals, r.variable, S).text;
  };
  it('polinómicas', () => {
    expect(iv('x^2-5x+6>0')).toBe('x ∈ (-∞, 2) ∪ (3, ∞)');
    expect(iv('x^2-5x+6\\le0')).toBe('x ∈ [2, 3]');
    expect(iv('2x+1<5')).toBe('x ∈ (-∞, 2)');
    expect(iv('x^2+1>0')).toBe('x ∈ ℝ');
    expect(iv('x^2<0')).toBe('Sin solución');
    expect(iv('x^2\\le0')).toBe('x ∈ {0}');
  });
  it('con polos y dominio', () => {
    expect(iv('\\frac{1}{x}>0')).toBe('x ∈ (0, ∞)');
    expect(iv('\\sqrt{x}\\ge2')).toBe('x ∈ [4, ∞)');
  });
});

describe('funciones', () => {
  it('definiciones para graficar', () => {
    expect(kind('f\\left(x\\right)=x^2', 'function')).toMatchObject({ name: 'f', vars: ['x'] });
    expect(kind('y=\\sin\\left(x\\right)', 'function')).toMatchObject({ name: 'y', vars: ['x'] });
    expect(kind('f\\left(x,y\\right)=x^2+y^2', 'function')).toMatchObject({ vars: ['x', 'y'] });
    expect(kind('\\sin\\left(x\\right)', 'function')).toMatchObject({ vars: ['x'] });
  });
});
