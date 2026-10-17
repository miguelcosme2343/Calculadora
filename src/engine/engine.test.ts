import { describe, expect, it } from 'vitest';
import { alternatives, calculate, DEFAULT_SETTINGS, formatIntervals, formatPoly, formatReal, formatValue, type Result, type Settings } from './index';

const S: Settings = { ...DEFAULT_SETTINGS };
const ctx = { angle: 'deg' as const };

function val(latex: string, c: Partial<typeof ctx> & { angle?: 'deg' | 'rad' } = {}) {
  const r = calculate(latex, { ...ctx, ...c });
  if (r.kind !== 'value') throw new Error(`${latex} → ${JSON.stringify(r)}`);
  return r.value;
}
const text = (latex: string, s: Partial<Settings> = {}, c = {}) => formatValue(val(latex, c), { ...S, ...s }).text;

describe('aritmética', () => {
  it('básico', () => {
    expect(text('2+3\\cdot4')).toBe('14');
    expect(text('\\frac{1}{3}+\\frac{1}{6}')).toBe('1/2');
    expect(text('0.1+0.2', { fractions: false })).toBe('0.3');
    expect(text('2^{10}')).toBe('1024');
    expect(text('-3^2')).toBe('-9');
    expect(text('\\left(-3\\right)^2')).toBe('9');
    expect(text('2\\left(3+4\\right)')).toBe('14');
    expect(text('\\sqrt{16}')).toBe('4');
    expect(text('\\sqrt[3]{-8}')).toBe('-2');
    expect(text('5!')).toBe('120');
    expect(text('\\left|-7\\right|')).toBe('7');
    expect(text('50\\%')).toBe('1/2');
    // en LaTeX x^23 es x²·3
    expect(calculate('x^23', ctx)).toMatchObject({ kind: 'poly', variable: 'x' });
  });
  it('implícita y funciones', () => {
    expect(text('\\sin\\left(30\\right)')).toBe('1/2');
    expect(text('\\sin30\\degree')).toBe('1/2');
    expect(text('\\sin\\left(\\frac{\\pi}{6}\\right)', {}, { angle: 'rad' })).toBe('1/2');
    expect(text('\\sin^2\\left(30\\right)+\\cos^2\\left(30\\right)')).toBe('1');
    expect(text('\\sin^{-1}\\left(1\\right)')).toBe('90');
    expect(text('\\arcsin\\left(1\\right)', {}, { angle: 'rad' })).toBe('π/2');
    expect(text('\\ln\\left(e^2\\right)')).toBe('2');
    expect(text('\\log\\left(1000\\right)')).toBe('3');
    expect(text('\\log_2\\left(8\\right)')).toBe('3');
    expect(text('\\log_{2}8')).toBe('3');
    expect(text('2\\pi', { fractions: false })).toBe('6.28319');
    expect(text('\\cos\\left(90\\right)')).toBe('0');
    expect(text('\\sin180')).toBe('0');
  });
  it('coma decimal de MathLive', () => {
    expect(text('1{,}5+1', { fractions: false })).toBe('2.5');
  });
});

describe('complejos y fasores', () => {
  it('rectangular y polar', () => {
    expect(text('3+4j', { complexForm: 'polar' })).toBe('5∠53.1301°');
    expect(text('3+4i', { complexForm: 'rect', imagUnit: 'i' })).toBe('3 + 4i');
    expect(text('3-4j', { complexForm: 'rect' })).toBe('3 - j4');
    expect(text('10\\angle30\\degree', { complexForm: 'rect' })).toBe('8.66025 + j5');
    expect(text('10\\angle30', { complexForm: 'rect' })).toBe('8.66025 + j5');
    expect(text('10\\angle90', { complexForm: 'rect' })).toBe('j10');
    expect(text('\\left(10\\angle30\\right)\\cdot\\left(2\\angle15\\right)')).toBe('20∠45°');
    expect(text('\\frac{10\\angle0}{5\\angle-90}')).toBe('2∠90°');
    expect(text('\\sqrt{-4}', { complexForm: 'rect' })).toBe('j2');
    expect(text('j^2')).toBe('-1');
    expect(text('\\operatorname{Re}\\left(3+4j\\right)')).toBe('3');
    expect(text('\\operatorname{arg}\\left(1+j\\right)')).toBe('45');
    expect(text('\\overline{3+4j}', { complexForm: 'rect' })).toBe('3 - j4');
  });
  it('paralelo', () => {
    expect(text('6\\parallel3')).toBe('2');
    expect(text('2+6\\parallel3')).toBe('4');
    expect(text('10\\parallel10j', { complexForm: 'rect' })).toBe('5 + j5');
  });
  it('alternativas', () => {
    const alts = alternatives(val('3+4j'), S).map(a => a.text);
    expect(alts).toContain('3 + j4');
  });
});

describe('formatos', () => {
  it('ingeniería, científica y fija', () => {
    expect(formatReal(4700, S, 'eng').text).toBe('4.7 k');
    expect(formatReal(0.0000033, S, 'eng').text).toBe('3.3 µ');
    expect(formatReal(4700, { ...S, engPrefix: false }, 'eng').text).toBe('4.7e3');
    expect(formatReal(123456, S, 'sci').text).toBe('1.23456e5');
    expect(formatReal(999999.9, S, 'eng').text).toBe('1 M');
    expect(formatReal(Math.PI, { ...S, decimals: 2 }, 'fixed').text).toBe('3.14');
    expect(formatReal(1.5e-7, S, 'auto').text).toBe('1.5e-7');
    expect(formatReal(2.5, { ...S, decimalComma: true }, 'auto').text).toBe('2,5');
  });
});

function sols(latex: string): string[] {
  const r = calculate(latex, ctx) as Extract<Result, { kind: 'solutions' }>;
  if (r.kind !== 'solutions') throw new Error(JSON.stringify(r));
  return r.roots.map(v => formatValue(v, { ...S, complexForm: 'rect' }).text);
}

describe('ecuaciones', () => {
  it('polinómicas', () => {
    expect(sols('2x+4=0')).toEqual(['-2']);
    expect(sols('x^2-5x+6=0')).toEqual(['2', '3']);
    expect(sols('x^2+1=0')).toEqual(['-j', 'j']);
    expect(sols('x^3-6x^2+11x-6=0')).toEqual(['1', '2', '3']);
    expect(sols('\\left(x-1\\right)^3=0')).toEqual(['1']);
    expect(sols('x^4=16')).toEqual(['-2', '2', '-j2', 'j2']);
  });
  it('no polinómicas', () => {
    expect(sols('e^x=2').map(Number)[0]).toBeCloseTo(Math.LN2, 5);
    expect(sols('\\frac{1}{x}=4')).toEqual(['1/4']);
    expect(sols('\\sin\\left(x\\right)=2')).toEqual([]);
  });
  it('identidades y comprobaciones', () => {
    expect(calculate('2+2=4', ctx)).toEqual({ kind: 'bool', value: true });
    expect(calculate('x+1=x+1', ctx)).toMatchObject({ kind: 'solutions', identity: true });
  });
  it('expansión', () => {
    const r = calculate('\\left(x+1\\right)^2', ctx);
    if (r.kind !== 'poly') throw new Error(JSON.stringify(r));
    expect(formatPoly(r.coeffs, r.variable, S).text).toBe('x^2 + 2·x + 1');
  });
});

describe('errores y entradas incompletas', () => {
  it('incompletas', () => {
    expect(calculate('2+', ctx).kind).toBe('incomplete');
    expect(calculate('\\frac{1}{\\placeholder{}}', ctx).kind).toBe('incomplete');
    expect(calculate('\\sqrt{}', ctx).kind).toBe('incomplete');
  });
  it('errores', () => {
    expect(calculate('1/0', ctx)).toMatchObject({ kind: 'error' });
    expect(calculate('xyz', ctx)).toMatchObject({ kind: 'needsVars' });
    expect(calculate('xy', ctx)).toMatchObject({ kind: 'function', vars: ['x', 'y'] });
    expect(calculate('\\operatorname{Ans}+1', ctx)).toMatchObject({ kind: 'error' });
    expect(text('\\operatorname{Ans}\\cdot2', {}, { ans: val('21') })).toBe('42');
  });
  it('LaTeX tal como lo serializa MathLive', () => {
    expect(text('\\operatorname{\\mathrm{Ans}}+1', {}, { ans: val('1') })).toBe('2');
    expect(text('\\operatorname{\\mathrm{Re}}\\left(3+4j\\right)')).toBe('3');
    expect(text('\\frac12+\\frac{1}{4}')).toBe('3/4');
    expect(text('\\sqrt{12}', { fractions: false })).toBe('3.4641');
  });
});
