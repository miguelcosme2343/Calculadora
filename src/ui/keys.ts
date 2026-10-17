// Teclado, organizado como el de Photomath (sin lo que no se usa) más la pestaña de complejos.
// Las etiquetas entre $…$ se dibujan como fórmulas.

interface Base { label: string; cls?: string; title?: string; alts?: Key[] }
export type Key =
  | (Base & { insert: string })
  | (Base & { typed: string })
  | (Base & { cmd: 'back' | 'left' | 'right' | 'newline' | 'history' | 'abc' | 'paste' })
  | (Base & { imag: true })
  | (Base & { decimal: true })
  | (Base & { blank: true })
  | (Base & { exec: string }); // comando de MathLive (añadir filas, columnas…)

const ins = (label: string, insert: string, extra: Partial<Base> = {}): Key => ({ label, insert, ...extra });
const fnKey = (name: string, label = `$\\${name}$`): Key => ins(label, `\\${name}\\left(#0\\right)`);
const opKey = (name: string, label = name): Key => ({ label, insert: `\\operatorname{${name}}\\left(#0\\right)`, cls: 'small' });

// Plantilla de matriz con huecos, y su etiqueta para la tecla
const env = (name: string, r: number, c: number) =>
  `\\begin{${name}}${Array.from({ length: r }, () => Array(c).fill('#?').join('&')).join('\\\\')}\\end{${name}}`;
const mx = (r: number, c: number, name = 'pmatrix') =>
  `$\\begin{${name}}${Array.from({ length: r }, () => Array(c).fill('\\square').join('&')).join('\\\\')}\\end{${name}}$`;

// Fila de herramientas (siempre visible)
export const TOOLS: Key[] = [
  { label: 'abc', cmd: 'abc', cls: 'tool', title: 'Letras' },
  { label: '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4"/></svg>', cmd: 'history', cls: 'tool icon', title: 'Historial' },
  { label: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/></svg>', cmd: 'paste', cls: 'tool icon', title: 'Pegar (texto o imagen con una fórmula)' },
  { label: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>', cmd: 'left', cls: 'tool icon', title: 'Mover a la izquierda' },
  { label: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>', cmd: 'right', cls: 'tool icon', title: 'Mover a la derecha' },
  { label: '<svg viewBox="0 0 24 24"><path d="M20 5v6a3 3 0 0 1-3 3H5M9 10l-4 4 4 4"/></svg>', cmd: 'newline', cls: 'tool icon', title: 'Nueva línea (sistema de ecuaciones)' },
  { label: '<svg viewBox="0 0 24 24"><path d="M21 5H9l-6 7 6 7h12zM12 9l6 6M18 9l-6 6"/></svg>', cmd: 'back', cls: 'tool icon', title: 'Borrar' },
];

// +−×÷: 6 columnas × 4 filas. Las teclas con alternativas (punto) se mantienen pulsadas.
export const NUMPAD: Key[] = [
  ins('$\\left(\\square\\right)$', '\\left(#0\\right)', {
    alts: [ins('$\\left[\\square\\right]$', '\\left[#0\\right]'), ins('$\\left|\\square\\right|$', '\\left|#0\\right|')],
  }),
  ins('>', '>', { alts: [ins('<', '<'), ins('≥', '\\ge '), ins('≤', '\\le ')] }),
  ins('7', '7', { cls: 'num' }), ins('8', '8', { cls: 'num' }), ins('9', '9', { cls: 'num' }),
  ins('÷', '\\div', { cls: 'opk' }),

  ins('$\\frac{\\square}{\\square}$', '\\frac{#@}{#?}', { title: 'Fracción' }),
  ins('$\\sqrt{\\square}$', '\\sqrt{#0}', {
    alts: [ins('$\\sqrt[3]{\\square}$', '\\sqrt[3]{#0}'), ins('$\\sqrt[n]{\\square}$', '\\sqrt[#?]{#0}')],
  }),
  ins('4', '4', { cls: 'num' }), ins('5', '5', { cls: 'num' }), ins('6', '6', { cls: 'num' }),
  ins('×', '\\cdot', { cls: 'opk' }),

  ins('$\\square^2$', '#@^{2}', {
    alts: [ins('$\\square^{n}$', '#@^{#?}'), ins('$\\square^{3}$', '#@^{3}'), ins('$\\square^{-1}$', '#@^{-1}')],
  }),
  ins('$x$', 'x', { alts: [ins('$y$', 'y'), ins('$z$', 'z'), ins('$t$', 't'), ins('$n$', 'n')] }),
  ins('1', '1', { cls: 'num' }), ins('2', '2', { cls: 'num' }), ins('3', '3', { cls: 'num' }),
  ins('−', '-', { cls: 'opk' }),

  ins('$\\pi$', '\\pi', { alts: [ins('$e$', 'e'), { label: 'j', imag: true }] }),
  ins('%', '\\%'),
  ins('0', '0', { cls: 'num' }),
  { label: '.', decimal: true, cls: 'num' },
  ins('=', '=', { cls: 'opk' }),
  ins('+', '+', { cls: 'opk' }),
];

export interface Panel {
  id: string;
  name: string; // etiqueta de la pestaña (HTML)
  cols: number;
  keys: Key[];
}

export const PANELS: Panel[] = [
  {
    id: 'fx',
    name: 'f(x) e<br>log ln',
    cols: 5,
    keys: [
      ins('$\\left|\\square\\right|$', '\\left|#0\\right|', { title: 'Valor absoluto' }),
      ins('$f(x)$', 'f\\left(x\\right)=', { title: 'Definir función (para graficar)' }),
      ins('$\\log_{10}$', '\\log_{10}\\left(#0\\right)'),
      { label: 'j', imag: true, title: 'Unidad imaginaria' },
      ins('$n!$', '!'),

      ins('$e$', 'e'),
      ins('$f(x,y)$', 'f\\left(x,y\\right)=', { title: 'Función de dos variables (superficie 3D)' }),
      ins('$\\log_{2}$', '\\log_{2}\\left(#0\\right)'),
      ins('$z$', 'z'),
      ins('$\\overline{z}$', '\\overline{#0}', { title: 'Conjugado' }),

      ins('exp', '\\exp\\left(#0\\right)'),
      ins('$\\ln$', '\\ln\\left(#0\\right)'),
      ins('$\\log_{\\square}$', '\\log_{#?}\\left(#0\\right)'),
      ins('$e^{\\square}$', 'e^{#?}'),
      ins('Ans', '\\operatorname{Ans}', { title: 'Resultado anterior' }),

      ins('$10^{\\square}$', '10^{#?}'),
      ins('$\\square^{-1}$', '#@^{-1}'),
      ins('$\\sqrt[3]{\\square}$', '\\sqrt[3]{#0}'),
      ins('$\\sqrt[n]{\\square}$', '\\sqrt[#?]{#0}'),
      ins('$\\times10^{n}$', '\\times10^{#?}', { title: 'Notación científica' }),
    ],
  },
  {
    id: 'trig',
    name: 'sin cos<br>tan cot',
    cols: 7,
    keys: [
      ins('rad', '\\operatorname{rad}', { cls: 'small', title: 'Ángulo en radianes' }),
      fnKey('sin'), fnKey('cos'), fnKey('tan'), fnKey('cot'), fnKey('sec'), fnKey('csc'),

      ins('$\\square^{\\circ}$', '\\degree', { title: 'Grados' }),
      fnKey('arcsin', 'arcsin'), fnKey('arccos', 'arccos'), fnKey('arctan', 'arctan'),
      opKey('arccot'), opKey('arcsec'), opKey('arccsc'),

      ins('$\\pi$', '\\pi'),
      fnKey('sinh', 'sinh'), fnKey('cosh', 'cosh'), fnKey('tanh', 'tanh'), fnKey('coth', 'coth'),
      opKey('sech'), opKey('csch'),

      ins('$\\theta$', '\\theta'),
      opKey('arsinh'), opKey('arcosh'), opKey('artanh'), opKey('arcoth'), opKey('arsech'), opKey('arcsch'),
    ].map(k => ('insert' in k && !k.cls ? { ...k, cls: 'small' } : k)),
  },
  {
    id: 'calc',
    name: 'lim dx<br>∫ Σ ∞',
    cols: 4,
    keys: [
      ins('$\\lim\\limits_{x\\to\\square}$', '\\lim_{x\\to#?}#?', { title: 'Límite' }),
      ins('$\\frac{d}{dx}\\square$', '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(#0\\right)', { title: 'Derivada' }),
      ins('$\\int\\square\\,dx$', '\\int#0\\,\\mathrm{d}x', { title: 'Integral indefinida (polinomios)' }),
      ins('$\\sum\\limits_{n=\\square}^{\\square}$', '\\sum_{n=#?}^{#?}#?', { title: 'Sumatorio' }),

      ins('$\\lim\\limits_{x\\to\\square^{+}}$', '\\lim_{x\\to#?^{+}}#?', { title: 'Límite por la derecha' }),
      ins('$\\frac{d}{d\\square}\\square$', '\\frac{\\mathrm{d}}{\\mathrm{d}#?}\\left(#0\\right)', { title: 'Derivada respecto a…' }),
      ins('$\\int_{\\square}^{\\square}\\square\\,dx$', '\\int_{#?}^{#?}#0\\,\\mathrm{d}x', { title: 'Integral definida' }),
      ins('$\\prod\\limits_{n=\\square}^{\\square}$', '\\prod_{n=#?}^{#?}#?', { title: 'Productorio' }),

      ins('$\\lim\\limits_{x\\to\\square^{-}}$', '\\lim_{x\\to#?^{-}}#?', { title: 'Límite por la izquierda' }),
      ins('$\\frac{d^2}{dx^2}\\square$', '\\frac{\\mathrm{d}^2}{\\mathrm{d}x^2}\\left(#0\\right)', { title: 'Derivada segunda' }),
      ins('$\\int_{\\square}^{\\square}\\square\\,d\\square$', '\\int_{#?}^{#?}#0\\,\\mathrm{d}#?', { title: 'Integral definida respecto a…' }),
      ins('$\\infty$', '\\infty'),

      ins('$\\lim\\limits_{x\\to\\infty}$', '\\lim_{x\\to\\infty}#?', { title: 'Límite en el infinito' }),
      ins('$x$', 'x'),
      ins('$n$', 'n'),
      ins('$e$', 'e'),
    ],
  },
  {
    id: 'mat',
    name: '[ ] det<br>matrices',
    cols: 5,
    keys: [
      ins(mx(2, 2), env('pmatrix', 2, 2), { title: 'Matriz 2×2', cls: 'small' }),
      ins(mx(3, 3), env('pmatrix', 3, 3), { title: 'Matriz 3×3', cls: 'small' }),
      ins(mx(2, 1), env('pmatrix', 2, 1), { title: 'Vector columna (2)', cls: 'small' }),
      ins(mx(3, 1), env('pmatrix', 3, 1), { title: 'Vector columna (3)', cls: 'small' }),
      ins(mx(1, 3), env('pmatrix', 1, 3), { title: 'Vector fila (3)', cls: 'small' }),

      ins(mx(2, 2, 'vmatrix'), env('vmatrix', 2, 2), { title: 'Determinante 2×2', cls: 'small' }),
      ins(mx(3, 3, 'vmatrix'), env('vmatrix', 3, 3), { title: 'Determinante 3×3', cls: 'small' }),
      ins('det', '\\det\\left(#0\\right)', { title: 'Determinante', cls: 'small' }),
      ins('$A^{-1}$', '#@^{-1}', { title: 'Inversa' }),
      ins('$A^{T}$', '#@^{T}', { title: 'Traspuesta' }),

      opKey('tr', 'traza'),
      opKey('rank', 'rango'),
      ins('$\\left(\\square\\right)$', '\\left(#0\\right)'),
      ins('×', '\\cdot', { cls: 'opk' }),
      ins('Ans', '\\operatorname{Ans}', { title: 'Resultado anterior' }),

      { label: '+ fila', exec: 'addRowAfter', cls: 'small', title: 'Añadir fila debajo' },
      { label: '+ columna', exec: 'addColumnAfter', cls: 'small', title: 'Añadir columna a la derecha' },
      { label: '− fila', exec: 'removeRow', cls: 'small', title: 'Quitar esta fila' },
      { label: '− columna', exec: 'removeColumn', cls: 'small', title: 'Quitar esta columna' },
      { label: '', blank: true },
    ],
  },
  {
    id: 'complex',
    name: 'ℂ ∠<br>fasores',
    cols: 5,
    keys: [
      { label: 'j', imag: true, title: 'Unidad imaginaria' },
      ins('$\\angle$', '\\angle', { title: 'Fasor: módulo∠ángulo' }),
      ins('$\\square^{\\circ}$', '\\degree', { title: 'Grados' }),
      ins('$\\parallel$', '\\parallel', { title: 'Paralelo: Z₁·Z₂/(Z₁+Z₂)' }),
      ins('$\\overline{z}$', '\\overline{#0}', { title: 'Conjugado' }),

      ins('$\\left|z\\right|$', '\\left|#0\\right|', { title: 'Módulo' }),
      opKey('arg'), opKey('Re'), opKey('Im'),
      ins('$e^{j\\square}$', 'e^{j#?}'),

      ins('$\\omega$', '\\omega'), ins('$\\theta$', '\\theta'), ins('$\\varphi$', '\\varphi'),
      ins('$Z$', 'Z'), ins('$V$', 'V'),

      ins('$R$', 'R'), ins('$L$', 'L'), ins('$C$', 'C'), ins('$I$', 'I'), ins('$f$', 'f'),
    ],
  },
];

// Letras (botón «abc» de la fila de herramientas)
export const ABC: Panel = {
  id: 'abc',
  name: 'abc',
  cols: 7,
  keys: 'abcdfghklmnpqrstuvwxyz'.split('').map(c => ins(`$${c}$`, c))
    .concat(['alpha', 'beta', 'gamma', 'theta', 'lambda', 'mu'].map(g => ins(`$\\${g}$`, `\\${g}`))),
};
