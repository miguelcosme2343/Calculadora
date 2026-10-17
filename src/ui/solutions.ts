// Panel «Soluciones»: todas las formas del resultado, gráficas y diagramas.
import { convertLatexToMarkup } from 'mathlive';
import {
  allForms, alternatives, compile, formatIntervals, formatMatrix, formatPoly, formatReal, formatValue, isDefaultForm, matrixInfo,
  varLatex, type Form, type Formatted, type Node, type Result, type Settings, type Z,
} from '../engine';
import type { EvalContext } from '../engine/evaluate';
import { mountPlot, type Arrow, type PlotSpec } from './plot';
import { mountSurface } from './surface';

export interface SheetDeps {
  settings: Settings;
  ctx: EvalContext;
  copy: (text: string) => void;
  setDefault: (patch: Partial<Settings>) => void;
}

const markup = (latex: string) => convertLatexToMarkup(latex);
const series = (i: number) => `var(--series-${(i % 3) + 1})`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function card(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'card');
  root.append(el('h3', 'card-title', title));
  const body = el('div', 'card-body');
  root.append(body);
  return { root, body };
}

// número real para graficar (NaN si no está definido o es complejo)
function realOf(v: Z | null): number {
  if (!v || !Number.isFinite(v.re)) return NaN;
  return Math.abs(v.im) <= 1e-9 * Math.max(1, Math.abs(v.re)) ? v.re : NaN;
}

const isComplex = (v: Z) => Math.abs(v.im) > 1e-12 * Math.max(1, Math.hypot(v.re, v.im));

export function buildSheet(r: Result, d: SheetDeps): { nodes: HTMLElement[]; destroy(): void } {
  const s = d.settings;
  const nodes: HTMLElement[] = [];
  const cleanups: (() => void)[] = [];
  const fmtNum = (v: number) => formatReal(v, { ...s, fractions: false }, s.notation === 'fixed' ? 'fixed' : 'auto').text;

  const formsList = (forms: Form[]) => {
    const list = el('ul', 'forms');
    for (const f of forms) {
      const li = el('li');
      const btn = el('button', 'form-row');
      btn.title = 'Copiar';
      const label = el('span', 'form-label', f.label);
      if (isDefaultForm(f, s)) label.append(el('span', 'badge', 'Predeterminada'));
      btn.append(label, el('span', 'form-value', markup(f.latex)));
      btn.addEventListener('click', () => d.copy(f.text));
      li.append(btn);
      if (f.patch && !isDefaultForm(f, s)) {
        const pin = el('button', 'pin', 'Usar por defecto');
        pin.addEventListener('click', () => d.setDefault(f.patch!));
        li.append(pin);
      }
      list.append(li);
    }
    return list;
  };

  const valueLine = (prefix: string, f: Formatted, alts: Formatted[] = []) => {
    const box = el('div', 'sol-line');
    const main = el('button', 'sol-main', markup(prefix + f.latex));
    main.title = 'Copiar';
    main.addEventListener('click', () => d.copy(f.text));
    box.append(main);
    if (alts.length) {
      const chips = el('div', 'sol-alts');
      for (const a of alts) {
        const c = el('button', 'chip-alt', markup(a.latex));
        c.title = a.label ?? '';
        c.addEventListener('click', () => d.copy(a.text));
        chips.append(c);
      }
      box.append(chips);
    }
    return box;
  };

  const plot = (title: string, spec: PlotSpec, note = '') => {
    const c = card(title);
    const host = el('div', 'plot-host');
    c.body.append(host);
    if (note) c.body.append(el('p', 'card-note', note));
    nodes.push(c.root);
    // se monta cuando el nodo ya está en el documento (necesita medidas)
    requestAnimationFrame(() => cleanups.push(mountPlot(host, { formatValue: fmtNum, ...spec }).destroy));
  };

  const surface = (title: string, f: (x: number, y: number) => number, names: [string, string]) => {
    const c = card(title);
    const host = el('div', 'plot-host');
    c.body.append(host);
    c.body.append(el('p', 'card-note', 'Arrastra para girar; + y − cambian el dominio. ' + radNote));
    nodes.push(c.root);
    requestAnimationFrame(() => cleanups.push(mountSurface(host, f, names).destroy));
  };

  // Las funciones se dibujan en radianes; las ecuaciones, con la unidad elegida (como sus soluciones)
  const radCtx: EvalContext = { ...d.ctx, angle: 'rad' };
  const radNote = d.ctx.angle === 'deg' ? 'Gráfica con los ángulos en radianes.' : '';
  const fn1 = (body: Node, v: string, c: EvalContext = d.ctx) => {
    const g = compile(body, [v], c);
    return (x: number) => realOf(g(x));
  };

  switch (r.kind) {
    case 'value': {
      const c = card('Resultado');
      c.body.append(valueLine('=', formatValue(r.value, s)));
      c.body.append(formsList(allForms(r.value, s)));
      nodes.push(c.root);
      if (isComplex(r.value) || hasAngle(r.ast)) phasorCard(r.ast, r.value);
      break;
    }
    case 'matrix': {
      const M = r.value;
      const c = card('Resultado');
      c.body.append(valueLine('=', formatMatrix(M, s)));
      nodes.push(c.root);
      const info = matrixInfo(M);
      const p = card('Propiedades');
      const rows: Form[] = [{ label: 'Dimensión', latex: `${M.rows}\\times${M.cols}`, text: `${M.rows}×${M.cols}` }];
      if (info.det) rows.push({ label: 'Determinante', ...formatValue(info.det, s) });
      if (info.trace) rows.push({ label: 'Traza', ...formatValue(info.trace, s) });
      rows.push({ label: 'Rango', latex: String(info.rank), text: String(info.rank) });
      if (info.inverse) rows.push({ label: 'Inversa', ...formatMatrix(info.inverse, s) });
      else if (info.inverseError) rows.push({ label: 'Inversa', latex: '\\text{no existe}', text: 'no existe' });
      rows.push({ label: 'Traspuesta', ...formatMatrix(info.transpose, s) });
      p.body.append(formsList(rows));
      nodes.push(p.root);
      if (info.eigen) {
        const e = card('Valores propios');
        info.eigen.roots.forEach((v, k) => {
          const line = valueLine(`\\lambda_{${k + 1}}=`, formatValue(v, s), alternatives(v, s));
          const mult = info.eigen!.mult[k];
          if (mult > 1) line.append(el('span', 'card-note', mult === 2 ? 'Doble' : mult === 3 ? 'Triple' : `Multiplicidad ${mult}`));
          e.body.append(line);
        });
        nodes.push(e.root);
      }
      break;
    }
    case 'solutions': {
      const c = card(r.identity ? 'Identidad' : 'Soluciones');
      const x = varLatex(r.variable);
      if (r.identity) c.body.append(el('p', 'card-text', 'La igualdad se cumple para cualquier valor.'));
      r.roots.forEach((root, k) => {
        const name = r.roots.length > 1 ? `${x}_{${k + 1}}` : x;
        c.body.append(valueLine(`${name}=`, formatValue(root, s), alternatives(root, s)));
      });
      if (r.note) c.body.append(el('p', 'card-note', r.note));
      nodes.push(c.root);
      const realRoots = r.roots.filter(z => !isComplex(z));
      const L = fn1(r.lhs, r.variable), R = fn1(r.rhs, r.variable);
      const rhsZero = r.rhs.k === 'num' && r.rhs.v === 0;
      plot('Gráfica', {
        curves: rhsZero
          ? [{ f: L, label: 'f(x)', color: series(0) }]
          : [{ f: L, label: 'Lado izquierdo', color: series(0) }, { f: R, label: 'Lado derecho', color: series(1) }],
        markers: realRoots.map(z => ({ x: z.re, y: L(z.re), label: `${r.variable} = ${fmtNum(z.re)}` })),
      });
      if (r.roots.some(isComplex)) {
        plot('Raíces en el plano complejo', {
          equal: true,
          axisNames: ['Re', 'Im'],
          markers: r.roots.map(z => ({ x: z.re, y: z.im, label: formatValue(z, { ...s, complexForm: 'rect' }).text })),
        });
      }
      break;
    }
    case 'system': {
      const c = card(r.solutions.length > 1 ? 'Soluciones' : 'Solución');
      r.solutions.forEach((sol, k) => {
        if (r.solutions.length > 1) c.body.append(el('h4', 'sol-head', `Solución ${k + 1}`));
        r.vars.forEach((v, i) => c.body.append(valueLine(`${varLatex(v)}=`, formatValue(sol[i], s), alternatives(sol[i], s))));
      });
      if (r.note) c.body.append(el('p', 'card-note', r.note));
      nodes.push(c.root);
      const complexSol = r.solutions.some(sol => sol.some(isComplex));
      if (r.vars.length === 2 && !complexSol && r.ast) {
        const eqs = r.ast.k === 'system' ? r.ast.eqs : [];
        plot('Gráfica', {
          equal: true,
          implicits: eqs.slice(0, 3).map((e, i) => {
            const F = compile(e.k === 'eq' ? { k: 'bin', op: '-', a: e.a, b: e.b } : e, r.vars, d.ctx);
            return { F: (x: number, y: number) => realOf(F(x, y)), label: `Ecuación ${i + 1}`, color: series(i) };
          }),
          axisNames: [r.vars[0], r.vars[1]],
          markers: r.solutions.map(sol => ({ x: sol[0].re, y: sol[1].re, label: `(${fmtNum(sol[0].re)}, ${fmtNum(sol[1].re)})` })),
        });
      }
      if (complexSol && r.solutions.length === 1) {
        const sol = r.solutions[0];
        plot('Diagrama fasorial', {
          equal: true,
          axisNames: ['Re', 'Im'],
          arrows: sol.slice(0, 3).map((z, i) => ({ x0: 0, y0: 0, x1: z.re, y1: z.im, color: series(i), label: r.vars[i] })),
        });
      }
      break;
    }
    case 'inequality': {
      const c = card('Solución');
      const f = formatIntervals(r.intervals, r.variable, s);
      c.body.append(valueLine('', f));
      nodes.push(c.root);
      if (r.ast?.k === 'rel') {
        const L = fn1(r.ast.a, r.variable), R = fn1(r.ast.b, r.variable);
        plot('Gráfica', {
          curves: [{ f: L, label: 'Lado izquierdo', color: series(0) }, { f: R, label: 'Lado derecho', color: series(1) }],
          bands: r.intervals.map(i => ({ lo: i.lo, hi: i.hi })),
        });
      }
      break;
    }
    case 'poly': {
      const c = card(r.antiderivative ? 'Integral' : 'Expresión desarrollada');
      const f = formatPoly(r.coeffs, r.variable, s);
      c.body.append(valueLine('=', r.antiderivative ? { latex: f.latex + '+C', text: f.text + ' + C' } : f));
      nodes.push(c.root);
      const coeffs = r.coeffs;
      if (coeffs.every(k => !isComplex(k))) {
        const P = (x: number) => coeffs.reduceRight((acc, k) => acc * x + k.re, 0);
        plot('Gráfica', { curves: [{ f: P, label: r.antiderivative ? 'F(x)' : 'f(x)', color: series(0) }] });
      }
      break;
    }
    case 'symbolic': {
      const c = card('Resultado');
      c.body.append(valueLine('=', { latex: r.latex, text: r.text }));
      nodes.push(c.root);
      if (r.vars.length === 1) {
        const v = r.vars[0];
        const curves = [{ f: fn1(r.ast, v, radCtx), label: 'Derivada', color: series(0) }];
        if (r.ast.k === 'deriv') curves.unshift({ f: fn1(r.ast.a, v, radCtx), label: 'Función', color: series(1) });
        plot('Gráfica', { curves }, radNote);
      }
      break;
    }
    case 'function': {
      if (r.vars.length === 1) {
        plot('Gráfica', { curves: [{ f: fn1(r.body, r.vars[0], radCtx), label: `${r.name ?? 'f'}(${r.vars[0]})`, color: series(0) }] }, radNote);
      } else if (r.vars.length === 2) {
        const g = compile(r.body, r.vars, radCtx);
        surface('Superficie', (x, y) => realOf(g(x, y)), [r.vars[0], r.vars[1]]);
      }
      break;
    }
  }

  // Fasores: los sumandos se dibujan uno tras otro y el resultado desde el origen
  function phasorCard(ast: Node, total: Z) {
    const terms = sumTerms(ast);
    const arrows: Arrow[] = [];
    if (terms.length >= 2 && terms.length <= 6) {
      let x = 0, y = 0;
      try {
        terms.forEach((t, i) => {
          const g = compile(t, [], d.ctx)();
          if (!g) throw new Error();
          arrows.push({ x0: x, y0: y, x1: x + g.re, y1: y + g.im, color: series(i + 1), faded: true, label: `${i + 1}` });
          x += g.re; y += g.im;
        });
      } catch {
        arrows.length = 0;
      }
    }
    arrows.push({ x0: 0, y0: 0, x1: total.re, y1: total.im, color: 'var(--accent)', label: 'Resultado' });
    plot('Diagrama fasorial', { equal: true, axisNames: ['Re', 'Im'], arrows });
  }

  return { nodes, destroy: () => cleanups.forEach(f => f()) };
}

function hasAngle(n: Node): boolean {
  if (n.k === 'bin') return n.op === 'angle' || hasAngle(n.a) || hasAngle(n.b);
  if (n.k === 'neg') return hasAngle(n.a);
  return false;
}

// Sumandos de primer nivel (con su signo)
function sumTerms(n: Node): Node[] {
  if (n.k === 'bin' && n.op === '+') return [...sumTerms(n.a), ...sumTerms(n.b)];
  if (n.k === 'bin' && n.op === '-') return [...sumTerms(n.a), ...sumTerms(n.b).map(t => ({ k: 'neg', a: t }) as Node)];
  return [n];
}
