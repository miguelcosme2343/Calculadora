import { describe, expect, it } from 'vitest';
import { calculate, DEFAULT_SETTINGS, formatMatrix, formatValue, matrixInfo, type Result } from './index';

const S = { ...DEFAULT_SETTINGS, complexForm: 'rect' as const };
const ctx = { angle: 'deg' as const };
const M2 = '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}';
const M3 = '\\begin{pmatrix}2&0&1\\\\1&3&2\\\\1&1&2\\end{pmatrix}';

function mat(latex: string): string {
  const r = calculate(latex, ctx);
  if (r.kind !== 'matrix') throw new Error(`${latex} → ${JSON.stringify(r)}`);
  return formatMatrix(r.value, S).text;
}
function num(latex: string): string {
  const r = calculate(latex, ctx);
  if (r.kind !== 'value') throw new Error(`${latex} → ${JSON.stringify(r)}`);
  return formatValue(r.value, S).text;
}
const kind = (latex: string) => calculate(latex, ctx).kind;

describe('matrices', () => {
  it('se leen tal como las escribe MathLive', () => {
    expect(mat(M2)).toBe('[[1, 2], [3, 4]]');
    expect(mat('\\begin{bmatrix}1 & 2\\\\ 3 & 4\\end{bmatrix}')).toBe('[[1, 2], [3, 4]]');
    expect(mat('\\begin{pmatrix}\\frac{1}{2}&\\sqrt{4}\\end{pmatrix}')).toBe('[[1/2, 2]]');
  });
  it('operaciones', () => {
    expect(mat(`${M2}+${M2}`)).toBe('[[2, 4], [6, 8]]');
    expect(mat(`2${M2}`)).toBe('[[2, 4], [6, 8]]');
    expect(mat(`${M2}\\cdot${M2}`)).toBe('[[7, 10], [15, 22]]');
    expect(mat(`${M2}\\begin{pmatrix}1\\\\1\\end{pmatrix}`)).toBe('[[3], [7]]');
    expect(mat(`${M2}^2`)).toBe('[[7, 10], [15, 22]]');
    expect(mat(`${M2}^{-1}`)).toBe('[[-2, 1], [3/2, -1/2]]');
    expect(mat(`${M2}^{T}`)).toBe('[[1, 3], [2, 4]]');
    expect(mat(`\\frac{${M2}}{2}`)).toBe('[[1/2, 1], [3/2, 2]]');
  });
  it('determinantes y funciones', () => {
    expect(num(`\\det\\left(${M2}\\right)`)).toBe('-2');
    expect(num('\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}')).toBe('-2');
    expect(num(`\\det\\left(${M3}\\right)`)).toBe('6');
    expect(num(`\\operatorname{tr}\\left(${M3}\\right)`)).toBe('7');
    expect(num('\\operatorname{rank}\\left(\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}\\right)')).toBe('1');
    expect(num(`\\det\\left(${M2}\\right)+1`)).toBe('-1');
    expect(num(`\\left|${M2}\\right|`)).toBe('-2');
  });
  it('con complejos (impedancias)', () => {
    expect(num('\\det\\left(\\begin{pmatrix}2+j&-1\\\\-1&3-2j\\end{pmatrix}\\right)')).toBe('7 - j');
  });
  it('errores claros', () => {
    expect(calculate(`${M2}+\\begin{pmatrix}1&2&3\\end{pmatrix}`, ctx)).toMatchObject({ kind: 'error' });
    expect(calculate('\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}^{-1}', ctx)).toMatchObject({ kind: 'error', message: expect.stringMatching(/inversa/) });
    expect(calculate(`\\det\\left(\\begin{pmatrix}1&2&3\\end{pmatrix}\\right)`, ctx)).toMatchObject({ kind: 'error' });
    expect(kind('\\begin{pmatrix}1&\\placeholder{}\\end{pmatrix}')).toBe('incomplete');
    expect(kind('\\begin{pmatrix}x&1\\end{pmatrix}')).toBe('error');
  });
  it('propiedades y valores propios', () => {
    const r = calculate('\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}', ctx) as Extract<Result, { kind: 'matrix' }>;
    const info = matrixInfo(r.value);
    expect(formatValue(info.det!, S).text).toBe('3');
    expect(info.rank).toBe(2);
    expect(info.eigen!.roots.map(v => formatValue(v, S).text)).toEqual(['1', '3']);
    const rot = calculate('\\begin{pmatrix}0&-1\\\\1&0\\end{pmatrix}', ctx) as Extract<Result, { kind: 'matrix' }>;
    expect(matrixInfo(rot.value).eigen!.roots.map(v => formatValue(v, S).text)).toEqual(['-j', 'j']);
  });
  it('los sistemas siguen funcionando con «&» de alineación', () => {
    expect(calculate('\\begin{cases}x&=1+y\\\\x+y&=3\\end{cases}', ctx)).toMatchObject({ kind: 'system', vars: ['x', 'y'] });
  });
});
