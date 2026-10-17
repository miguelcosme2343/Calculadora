// Parser del LaTeX que genera MathLive (y del que pueda venir pegado) a un AST propio.

export type RelOp = '<' | '>' | '<=' | '>=';

export type Node =
  | { k: 'num'; v: number }
  | { k: 'const'; name: 'pi' | 'e' | 'i' }
  | { k: 'var'; name: string }
  | { k: 'ans' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^' | 'angle' | 'par'; a: Node; b: Node }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'deg'; a: Node } // x°
  | { k: 'radu'; a: Node } // x rad
  | { k: 'eq'; a: Node; b: Node }
  | { k: 'rel'; op: RelOp; a: Node; b: Node }
  | { k: 'system'; eqs: Node[] }
  | { k: 'tuple'; items: Node[] } // (x, y) en f(x, y)
  | { k: 'matrix'; rows: Node[][] }
  | { k: 'deriv'; v: string; order: number; a: Node }
  | { k: 'integral'; v: string; lo?: Node; hi?: Node; a: Node }
  | { k: 'lim'; v: string; to: Node; side: -1 | 0 | 1; a: Node }
  | { k: 'sum'; v: string; from: Node; to: Node; a: Node; prod: boolean };

export class ParseError extends Error {
  constructor(message: string, readonly incomplete = false) {
    super(message);
  }
}

type Tok =
  | { t: 'num'; v: string }
  | { t: 'cmd'; v: string } // \nombre, sin la barra
  | { t: 'ch'; v: string }; // cualquier otro carácter

const SPACING = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'enspace', 'thinspace', 'medspace', 'thickspace']);
// Delimitadores de tamaño y estilos que no aportan significado
const SIZERS = new Set([
  'left', 'right', 'mleft', 'mright', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'big', 'Big',
  'displaystyle', 'textstyle', 'limits', 'nolimits',
]);

const UNICODE: Record<string, Tok> = {
  '°': { t: 'cmd', v: 'degree' }, '∠': { t: 'cmd', v: 'angle' }, '∥': { t: 'cmd', v: 'parallel' },
  '·': { t: 'cmd', v: 'cdot' }, '×': { t: 'cmd', v: 'times' }, '÷': { t: 'cmd', v: 'div' },
  '−': { t: 'ch', v: '-' }, 'π': { t: 'cmd', v: 'pi' }, '√': { t: 'cmd', v: 'sqrt' },
  '≤': { t: 'cmd', v: 'le' }, '≥': { t: 'cmd', v: 'ge' }, '∞': { t: 'cmd', v: 'infty' },
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c) || c === '~') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let s = '';
      while (i < src.length) {
        if (/[0-9.]/.test(src[i])) { s += src[i++]; continue; }
        // coma decimal que MathLive serializa como {,}
        if (src.startsWith('{,}', i) && /[0-9]/.test(src[i + 3] ?? '')) { s += '.'; i += 3; continue; }
        break;
      }
      if ((s.match(/\./g) ?? []).length > 1) throw new ParseError('Número mal escrito: ' + s);
      out.push({ t: 'num', v: s });
      continue;
    }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) { i++; continue; }
      i += m[0].length;
      if (SPACING.has(m[1]) || SIZERS.has(m[1])) continue;
      out.push({ t: 'cmd', v: m[1] });
      continue;
    }
    out.push(UNICODE[c] ?? { t: 'ch', v: c });
    i++;
  }
  return out;
}

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Phi', 'Psi', 'Omega',
]);

// Funciones de un argumento. Clave: nombre en LaTeX u \operatorname; valor: nombre interno.
const FUNCS: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot', cosec: 'csc', cotg: 'cot', tg: 'tan',
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', arccot: 'acot', arcsec: 'asec', arccsc: 'acsc',
  asin: 'asin', acos: 'acos', atan: 'atan', acot: 'acot', asec: 'asec', acsc: 'acsc',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', coth: 'coth', sech: 'sech', csch: 'csch',
  arsinh: 'asinh', arcosh: 'acosh', artanh: 'atanh', arcoth: 'acoth', arsech: 'asech', arcsch: 'acsch',
  arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh', arccoth: 'acoth', arcsech: 'asech', arccsch: 'acsch',
  asinh: 'asinh', acosh: 'acosh', atanh: 'atanh', acoth: 'acoth', asech: 'asech', acsch: 'acsch',
  ln: 'ln', log: 'log', lg: 'log', exp: 'exp', arg: 'arg', Re: 're', Im: 'im', re: 're', im: 'im',
  det: 'det', tr: 'trace', trace: 'trace', rank: 'rank', rango: 'rank', rg: 'rank', inv: 'inv',
  conj: 'conj', abs: 'abs', sgn: 'sign', sign: 'sign', floor: 'floor', ceil: 'ceil', round: 'round',
};
const INVERSE: Record<string, string> = {
  sin: 'asin', cos: 'acos', tan: 'atan', cot: 'acot', sec: 'asec', csc: 'acsc',
  sinh: 'asinh', cosh: 'acosh', tanh: 'atanh', coth: 'acoth', sech: 'asech', csch: 'acsch',
};
const STYLES = new Set(['mathrm', 'mathit', 'mathbf', 'mathsf', 'text', 'textrm', 'operatorname']);
const MATRIX_ENVS = new Set(['pmatrix', 'bmatrix', 'Bmatrix', 'matrix', 'smallmatrix', 'vmatrix']);
const SYSTEM_ENVS = new Set(['cases', 'rcases', 'aligned', 'align', 'gathered', 'array', 'split']);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const DEG = Symbol('deg');
const FAIL = Symbol('fail');

class Parser {
  private p = 0;
  private absDepth = 0;
  private diffStop = 0; // dentro de una integral: «dx» termina el integrando
  constructor(private toks: Tok[]) {}

  parse(): Node {
    if (this.toks.length === 0) throw new ParseError('', true);
    const n = this.isCmd('begin') && SYSTEM_ENVS.has(this.envNameAhead()) ? this.environment() : this.equation();
    if (this.p < this.toks.length) throw new ParseError('No entiendo «' + show(this.toks[this.p]) + '»');
    return n;
  }

  private peek(o = 0): Tok | undefined { return this.toks[this.p + o]; }
  private is(t: Tok['t'], v?: string, o = 0): boolean {
    const k = this.peek(o);
    return !!k && k.t === t && (v === undefined || k.v === v);
  }
  private isCh(...vs: string[]) { return vs.some(v => this.is('ch', v)); }
  private isCmd(...vs: string[]) { return vs.some(v => this.is('cmd', v)); }
  private next(): Tok {
    const k = this.toks[this.p++];
    if (!k) throw new ParseError('Expresión incompleta', true);
    return k;
  }
  private expectCh(v: string) {
    if (!this.is('ch', v)) {
      if (this.p >= this.toks.length) throw new ParseError('Expresión incompleta', true);
      throw new ParseError(`Se esperaba «${v}»`);
    }
    this.p++;
  }

  private envNameAhead(): string {
    const save = this.p;
    try {
      this.p++;
      return this.rawGroup();
    } catch {
      return '';
    } finally {
      this.p = save;
    }
  }

  // --- Sistemas: \begin{cases} … \\ … \end{cases} ---
  private environment(): Node {
    this.p++;
    const env = this.rawGroup();
    if (!SYSTEM_ENVS.has(env)) throw new ParseError('Entorno no soportado: ' + env);
    if (env === 'array' && this.isCh('{')) this.rawGroup(); // especificación de columnas
    // los «&» de alineación del propio sistema no cuentan (los de matrices anidadas sí)
    for (let i = this.p, depth = 0; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t.t === 'cmd' && t.v === 'begin') depth++;
      else if (t.t === 'cmd' && t.v === 'end') { if (depth-- === 0) break; }
      else if (depth === 0 && t.t === 'ch' && t.v === '&') this.toks.splice(i--, 1);
    }
    const eqs: Node[] = [];
    for (;;) {
      if (this.p >= this.toks.length) throw new ParseError('Sistema incompleto', true);
      if (this.isCmd('end')) { this.p++; this.rawGroup(); break; }
      if (this.isCmd('\\')) { this.p++; continue; } // fila vacía
      eqs.push(this.equation());
      if (this.isCmd('\\')) this.p++;
      else if (!this.isCmd('end')) throw new ParseError('No entiendo «' + show(this.toks[this.p]) + '»');
    }
    if (eqs.length === 1) return eqs[0];
    return { k: 'system', eqs };
  }

  private relOp(): RelOp | '=' | null {
    if (this.isCh('=')) return '=';
    if (this.isCh('<') || this.isCmd('lt')) return '<';
    if (this.isCh('>') || this.isCmd('gt')) return '>';
    if (this.isCmd('le', 'leq', 'leqslant')) return '<=';
    if (this.isCmd('ge', 'geq', 'geqslant')) return '>=';
    return null;
  }

  private equation(): Node {
    const a = this.sum();
    const op = this.relOp();
    if (!op) return a;
    this.p++;
    const b = this.sum();
    if (this.relOp()) throw new ParseError('Solo se admite una relación por línea');
    return op === '=' ? { k: 'eq', a, b } : { k: 'rel', op, a, b };
  }

  private sum(): Node {
    let a = this.parallel();
    while (this.isCh('+', '-')) {
      const op = (this.next() as { v: string }).v as '+' | '-';
      a = { k: 'bin', op, a, b: this.parallel() };
    }
    return a;
  }

  private parallel(): Node {
    let a = this.angle();
    while (this.isCmd('parallel', '|')) {
      this.p++;
      a = { k: 'bin', op: 'par', a, b: this.angle() };
    }
    return a;
  }

  private angle(): Node {
    const a = this.term();
    if (this.isCmd('angle', 'measuredangle')) {
      this.p++;
      return { k: 'bin', op: 'angle', a, b: this.term() };
    }
    return a;
  }

  private term(): Node {
    let a = this.unary();
    for (;;) {
      if (this.isCmd('cdot', 'times', 'ast') || this.isCh('*')) {
        this.p++;
        a = { k: 'bin', op: '*', a, b: this.unary() };
      } else if (this.isCmd('div') || this.isCh('/')) {
        this.p++;
        a = { k: 'bin', op: '/', a, b: this.unary() };
      } else if (this.startsFactor()) {
        a = { k: 'bin', op: '*', a, b: this.power() };
      } else return a;
    }
  }

  private unary(): Node {
    if (this.isCh('-')) { this.p++; return { k: 'neg', a: this.unary() }; }
    if (this.isCh('+')) { this.p++; return this.unary(); }
    return this.power();
  }

  private power(): Node {
    let a = this.primary();
    for (;;) {
      if (this.isCh('^')) {
        this.p++;
        const e = this.script();
        if (e !== DEG && e.k === 'var' && e.name === 'T' && contains(a, n => n.k === 'matrix')) {
          a = { k: 'fn', name: 'transpose', args: [a] }; // A^T
        } else {
          a = e === DEG ? { k: 'deg', a } : { k: 'bin', op: '^', a, b: e };
        }
      } else if (this.isCh('!')) {
        this.p++;
        a = { k: 'fn', name: 'fact', args: [a] };
      } else if (this.isCmd('degree', 'circ')) {
        this.p++;
        a = { k: 'deg', a };
      } else if (this.isCmd('%')) {
        this.p++;
        a = { k: 'bin', op: '/', a, b: { k: 'num', v: 100 } };
      } else if (this.styledWordAhead() === 'rad') {
        this.p++;
        this.rawGroup();
        a = { k: 'radu', a };
      } else if (this.isCh("'") || this.isCmd('prime')) {
        throw new ParseError('Las ecuaciones diferenciales aún no están soportadas');
      } else return a;
    }
  }

  // Argumento de ^ o _: {grupo} o un único token
  private script(): Node | typeof DEG {
    if (this.isCh('{')) {
      if (this.is('cmd', 'circ', 1) && this.is('ch', '}', 2)) { this.p += 3; return DEG; }
      return this.group();
    }
    if (this.isCmd('circ', 'degree')) { this.p++; return DEG; }
    const k = this.peek();
    if (k?.t === 'num') {
      // En LaTeX x^23 es x^2·3: solo cuenta el primer dígito
      this.p++;
      if (k.v.length > 1) this.toks.splice(this.p, 0, { t: 'num', v: k.v.slice(1) });
      return { k: 'num', v: Number(k.v[0]) };
    }
    return this.primary();
  }

  // Argumento de \frac, \sqrt, \overline: {grupo} o un único token (\frac12 = 1/2)
  private scriptArg(): Node {
    const s = this.script();
    if (s === DEG) throw new ParseError('Grados fuera de lugar');
    return s;
  }

  private group(): Node {
    this.expectCh('{');
    if (this.isCh('}')) throw new ParseError('Hay un hueco vacío', true);
    const saved = this.diffStop;
    this.diffStop = 0;
    const n = this.sum();
    this.diffStop = saved;
    this.expectCh('}');
    return n;
  }

  private startsFactor(): boolean {
    const k = this.peek();
    if (!k) return false;
    if (this.diffStop > 0 && this.atDifferential()) return false;
    if (k.t === 'num') return true;
    if (k.t === 'ch') {
      if (/[a-zA-Z(\[{]/.test(k.v)) return true;
      if (k.v === '|') return this.absDepth === 0;
      return false;
    }
    if (k.v === 'vert') return this.absDepth === 0;
    if (STYLES.has(k.v)) return this.styledWordAhead() !== 'rad';
    return k.v === 'lvert' || k.v === 'frac' || k.v === 'dfrac' || k.v === 'tfrac' || k.v === 'cfrac' ||
      k.v === 'sqrt' || k.v === 'pi' || k.v === 'infty' || GREEK.has(k.v) || hasOwn(FUNCS, k.v) ||
      k.v === 'overline' || k.v === 'imaginaryI' || k.v === 'imaginaryJ' || k.v === 'exponentialE' ||
      k.v === 'lbrack' || k.v === '{' || k.v === 'placeholder' || k.v === 'int' || k.v === 'lim' ||
      k.v === 'sum' || k.v === 'prod' || k.v === 'differentialD' || k.v === 'begin';
  }

  private primary(): Node {
    const k = this.next();
    if (k.t === 'num') {
      if (k.v === '.') throw new ParseError('Número mal escrito');
      return { k: 'num', v: Number(k.v) };
    }
    if (k.t === 'ch') {
      switch (k.v) {
        case '(': return this.closeWith(')');
        case '[': return this.closeWith(']');
        case '{': { this.p--; return this.group(); }
        case '|': return this.absUntil(() => this.isCh('|') || this.isCmd('vert', 'rvert'));
      }
      if (/[a-zA-Z]/.test(k.v)) return this.letter(k.v);
      if (k.v === ')' || k.v === ']' || k.v === '}') throw new ParseError('Paréntesis de cierre de más');
      throw new ParseError('No entiendo «' + k.v + '»');
    }
    const c = k.v;
    if (c === 'placeholder') throw new ParseError('Hay un hueco vacío', true);
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac' || c === 'cfrac') {
      const d = this.tryDerivative();
      if (d) return d;
      const a = this.scriptArg();
      const b = this.scriptArg();
      return { k: 'bin', op: '/', a, b };
    }
    if (c === 'sqrt') {
      if (this.isCh('[')) {
        this.p++;
        const n = this.sum();
        this.expectCh(']');
        return { k: 'fn', name: 'root', args: [n, this.scriptArg()] };
      }
      return { k: 'fn', name: 'sqrt', args: [this.scriptArg()] };
    }
    if (c === 'int') return this.integral();
    if (c === 'lim') return this.limit();
    if (c === 'sum' || c === 'prod') return this.series(c === 'prod');
    if (c === 'pi') return { k: 'const', name: 'pi' };
    if (c === 'infty') return { k: 'num', v: Infinity };
    if (c === 'exponentialE') return { k: 'const', name: 'e' };
    if (c === 'imaginaryI' || c === 'imaginaryJ') return { k: 'const', name: 'i' };
    if (c === 'lbrack') return this.closeWithCmd('rbrack');
    if (c === '{') return this.closeWithCmd('}');
    if (c === 'lvert' || c === 'vert') return this.absUntil(() => this.isCmd('rvert', 'vert') || this.isCh('|'));
    if (c === 'overline') return { k: 'fn', name: 'conj', args: [this.scriptArg()] };
    if (GREEK.has(c)) return this.subscripted(c);
    if (STYLES.has(c) || c === 'mathit') {
      const name = this.rawGroup();
      if (name === 'Ans' || name === 'ans') return { k: 'ans' };
      if (name === 'e') return { k: 'const', name: 'e' };
      if (name === 'i' || name === 'j') return { k: 'const', name: 'i' };
      if (name === 'd') throw new ParseError('Falta la integral o la derivada para «d»');
      if (hasOwn(FUNCS, name)) return this.func(name);
      if (/^[a-zA-Z]$/.test(name)) return this.letter(name);
      throw new ParseError('Función desconocida: ' + name);
    }
    if (c === 'begin') {
      const env = this.rawGroup();
      if (MATRIX_ENVS.has(env)) return this.matrix(env);
      throw new ParseError(SYSTEM_ENVS.has(env) ? 'Los sistemas van en una línea propia' : 'Entorno no soportado: ' + env);
    }
    if (c === 'top' || c === 'intercal') return { k: 'var', name: 'T' };
    if (hasOwn(FUNCS, c)) return this.func(c);
    if (c === 'cdot' || c === 'times') throw new ParseError('Falta un número antes de «×»');
    throw new ParseError('No entiendo «\\' + c + '»');
  }

  private letter(v: string): Node {
    if (v === 'e') return { k: 'const', name: 'e' };
    if (v === 'i' || v === 'j') return { k: 'const', name: 'i' };
    return this.subscripted(v);
  }

  private subscripted(name: string): Node {
    if (this.isCh('_')) {
      this.p++;
      name += '_' + this.rawScript();
    }
    return { k: 'var', name };
  }

  // Texto literal de un grupo {...}; ignora estilos anidados (\operatorname{\mathrm{Ans}})
  private rawGroup(): string {
    this.expectCh('{');
    let s = '';
    let depth = 1;
    for (;;) {
      const k = this.next();
      if (k.t === 'ch' && k.v === '{') depth++;
      else if (k.t === 'ch' && k.v === '}') { if (--depth === 0) return s; }
      else if (k.t === 'cmd') { if (!STYLES.has(k.v)) s += k.v; }
      else s += k.v;
    }
  }
  private rawScript(): string {
    if (this.isCh('{')) return this.rawGroup();
    return this.next().v;
  }
  // Si lo siguiente es \mathrm{palabra}, devuelve la palabra sin consumir nada
  private styledWordAhead(): string | null {
    if (!this.isCmd(...STYLES) || !this.is('ch', '{', 1)) return null;
    const save = this.p;
    try {
      this.p++;
      return this.rawGroup();
    } catch {
      return null;
    } finally {
      this.p = save;
    }
  }

  private closeWith(close: string): Node {
    if (this.isCh(close)) throw new ParseError('Paréntesis vacíos', true);
    const saved = [this.absDepth, this.diffStop];
    this.absDepth = 0;
    this.diffStop = 0;
    const n = this.sum();
    if (close === ')' && this.isCh(',')) {
      // tupla: f(x, y)
      const items = [n];
      while (this.isCh(',')) { this.p++; items.push(this.sum()); }
      [this.absDepth, this.diffStop] = saved;
      this.expectCh(close);
      return { k: 'tuple', items };
    }
    [this.absDepth, this.diffStop] = saved;
    this.expectCh(close);
    return n;
  }
  private closeWithCmd(close: string): Node {
    const n = this.sum();
    if (!this.isCmd(close)) throw new ParseError('Falta cerrar un paréntesis', true);
    this.p++;
    return n;
  }

  private absUntil(atClose: () => boolean): Node {
    this.absDepth++;
    const n = this.sum();
    this.absDepth--;
    if (!atClose()) throw new ParseError('Falta cerrar el valor absoluto', true);
    this.p++;
    return { k: 'fn', name: 'abs', args: [n] };
  }

  private func(latexName: string): Node {
    let name = FUNCS[latexName];
    let base: Node | null = null;
    let exponent: Node | null = null;
    // log_b
    if (this.isCh('_')) {
      this.p++;
      base = this.scriptArg();
    }
    if (this.isCh('^')) {
      this.p++;
      const s = this.script();
      if (s === DEG) throw new ParseError('Exponente no válido');
      // sin^{-1} → arcsin
      if (s.k === 'neg' && s.a.k === 'num' && s.a.v === 1 && hasOwn(INVERSE, name)) name = INVERSE[name];
      else exponent = s;
    }
    if (!this.startsFactor()) throw new ParseError('Falta el argumento de ' + latexName, true);
    const arg = this.funcArg();
    let n: Node = base
      ? { k: 'fn', name: 'logb', args: [base, arg] }
      : { k: 'fn', name, args: [arg] };
    if (exponent) n = { k: 'bin', op: '^', a: n, b: exponent };
    return n;
  }

  // (grupo) o, sin paréntesis, un producto implícito que se detiene en la siguiente función: sin 2x cos x
  private funcArg(): Node {
    // sin(x)^2 es (sin x)^2: el exponente lo recoge quien llamó
    if (this.isCh('(') || this.isCh('[')) return this.primary();
    let arg = this.power();
    while (this.startsFactor() && !this.startsFunction()) arg = { k: 'bin', op: '*', a: arg, b: this.power() };
    return arg;
  }

  private startsFunction(): boolean {
    const k = this.peek();
    if (!k || k.t !== 'cmd') return false;
    if (hasOwn(FUNCS, k.v) || k.v === 'int' || k.v === 'lim' || k.v === 'sum' || k.v === 'prod') return true;
    const w = this.styledWordAhead();
    return !!w && hasOwn(FUNCS, w);
  }

  // --- Matrices: \begin{pmatrix} a & b \\ c & d \end{pmatrix} ---
  private matrix(env: string): Node {
    const saved = [this.absDepth, this.diffStop];
    this.absDepth = 0;
    this.diffStop = 0;
    const rows: Node[][] = [];
    let row: Node[] = [];
    for (;;) {
      if (this.p >= this.toks.length) throw new ParseError('Matriz incompleta', true);
      if (this.isCmd('end')) {
        this.p++;
        this.rawGroup();
        if (row.length) rows.push(row);
        break;
      }
      row.push(this.sum());
      if (this.isCh('&')) { this.p++; continue; }
      if (this.isCmd('\\')) { this.p++; rows.push(row); row = []; continue; }
      if (!this.isCmd('end')) throw new ParseError('No entiendo «' + show(this.toks[this.p]) + '» dentro de la matriz');
    }
    [this.absDepth, this.diffStop] = saved;
    if (!rows.length) throw new ParseError('Matriz vacía', true);
    if (rows.some(r => r.length !== rows[0].length)) throw new ParseError('Todas las filas de la matriz deben tener los mismos elementos');
    const m: Node = { k: 'matrix', rows };
    return env === 'vmatrix' ? { k: 'fn', name: 'det', args: [m] } : m;
  }

  // --- Cálculo ---

  // d, \mathrm{d} o \differentialD
  private eatD(): boolean {
    if (this.isCh('d')) { this.p++; return true; }
    if (this.isCmd('differentialD')) { this.p++; return true; }
    if (this.styledWordAhead() === 'd') { this.p++; this.rawGroup(); return true; }
    return false;
  }
  private varName(): string {
    const k = this.next();
    let name: string;
    if (k.t === 'ch' && /[a-zA-Z]/.test(k.v)) name = k.v;
    else if (k.t === 'cmd' && GREEK.has(k.v)) name = k.v;
    else if (k.t === 'cmd' && k.v === 'placeholder') throw new ParseError('Falta la variable', true);
    else throw new ParseError('Se esperaba una variable');
    if (this.isCh('_')) { this.p++; name += '_' + this.rawScript(); }
    return name;
  }
  private intScript(): number {
    const s = this.scriptArg();
    if (s.k !== 'num' || !Number.isInteger(s.v) || s.v < 1 || s.v > 10) throw new ParseError('Orden de derivada no válido');
    return s.v;
  }

  // ¿Empieza aquí un diferencial «dx» que cierra el integrando?
  private atDifferential(): boolean {
    let o = 0;
    if (this.is('ch', 'd')) o = 1;
    else if (this.is('cmd', 'differentialD')) o = 1;
    else if (this.isCmd(...STYLES) && this.is('ch', '{', 1) && this.is('ch', 'd', 2) && this.is('ch', '}', 3)) o = 4;
    else return false;
    const v = this.peek(o);
    if (!v) return false;
    return (v.t === 'ch' && /[a-zA-Z]/.test(v.v)) || (v.t === 'cmd' && GREEK.has(v.v));
  }

  // \frac{d}{dx} f, \frac{d^2}{dx^2} f
  private tryDerivative(): Node | null {
    const save = this.p;
    try {
      if (!this.isCh('{')) throw FAIL;
      this.p++;
      if (!this.eatD()) throw FAIL;
      let order = 1;
      if (this.isCh('^')) { this.p++; order = this.intScript(); }
      if (!this.isCh('}')) {
        if (this.is('ch', '}', 1) || this.is('ch', '_', 1)) {
          throw new ParseError('Las ecuaciones diferenciales (dy/dx) aún no están soportadas');
        }
        throw FAIL;
      }
      this.p++;
      if (!this.isCh('{')) throw FAIL;
      this.p++;
      if (!this.eatD()) throw FAIL;
      const v = this.varName();
      if (this.isCh('^')) { this.p++; this.intScript(); }
      this.expectCh('}');
      if (!this.startsFactor() && !this.isCh('-')) throw new ParseError('Falta la función a derivar', true);
      return { k: 'deriv', v, order, a: this.term() };
    } catch (e) {
      if (e === FAIL) { this.p = save; return null; }
      throw e;
    }
  }

  private integral(): Node {
    let lo: Node | undefined;
    let hi: Node | undefined;
    for (let i = 0; i < 2; i++) {
      if (this.isCh('_')) { this.p++; lo = this.scriptArg(); }
      else if (this.isCh('^')) { this.p++; hi = this.scriptArg(); }
    }
    if (!!lo !== !!hi) throw new ParseError('Faltan los límites de integración', true);
    let a: Node = { k: 'num', v: 1 };
    this.diffStop++;
    try {
      if (!this.atDifferential()) a = this.sum();
    } finally {
      this.diffStop--;
    }
    if (!this.atDifferential()) throw new ParseError('Falta el diferencial (dx)', true);
    this.eatD();
    const v = this.varName();
    return { k: 'integral', v, lo, hi, a };
  }

  private limit(): Node {
    if (!this.isCh('_')) throw new ParseError('Falta «x→a» en el límite', true);
    this.p++;
    this.expectCh('{');
    const v = this.varName();
    if (!this.isCmd('to', 'rightarrow', 'longrightarrow')) throw new ParseError('Se esperaba «→» en el límite');
    this.p++;
    // límite lateral: a^{+} / a^{-} justo antes del cierre
    let close = this.p, depth = 1;
    for (; close < this.toks.length; close++) {
      const t = this.toks[close];
      if (t.t === 'ch' && t.v === '{') depth++;
      if (t.t === 'ch' && t.v === '}' && --depth === 0) break;
    }
    let side: -1 | 0 | 1 = 0;
    const tail = this.toks.slice(this.p, close).map(t => t.v).join(' ');
    const m = /\^ (?:\{ )?([+-])(?: \})?$/.exec(tail);
    if (m) {
      side = m[1] === '+' ? 1 : -1;
      const n = m[0].split(' ').length;
      this.toks.splice(close - n, n);
    }
    const to = this.sum();
    this.expectCh('}');
    if (!this.startsFactor() && !this.isCh('-')) throw new ParseError('Falta la función del límite', true);
    return { k: 'lim', v, to, side, a: this.term() };
  }

  private series(prod: boolean): Node {
    let v = '', from: Node | undefined, to: Node | undefined;
    for (let i = 0; i < 2; i++) {
      if (this.isCh('_')) {
        this.p++;
        this.expectCh('{');
        v = this.varName();
        this.expectCh('=');
        from = this.sum();
        this.expectCh('}');
      } else if (this.isCh('^')) {
        this.p++;
        to = this.scriptArg();
      }
    }
    if (!from || !to) throw new ParseError('Faltan los límites del sumatorio', true);
    if (!this.startsFactor() && !this.isCh('-')) throw new ParseError('Falta el término general', true);
    return { k: 'sum', v, from, to, a: this.term(), prod };
  }
}

function show(t: Tok): string {
  return t.t === 'cmd' ? '\\' + t.v : t.v;
}

export function parseLatex(latex: string): Node {
  return new Parser(tokenize(latex)).parse();
}

// Variables libres (las ligadas por integrales, límites y sumatorios no cuentan)
export function freeVars(n: Node, out = new Set<string>()): Set<string> {
  const bound = (v: string, inner: Node, extra: (Node | undefined)[]) => {
    const s = freeVars(inner);
    s.delete(v);
    s.forEach(x => out.add(x));
    extra.forEach(e => e && freeVars(e, out));
  };
  switch (n.k) {
    case 'var': out.add(n.name); break;
    case 'neg': case 'deg': case 'radu': case 'deriv': freeVars(n.a, out); break;
    case 'bin': case 'eq': case 'rel': freeVars(n.a, out); freeVars(n.b, out); break;
    case 'fn': n.args.forEach(a => freeVars(a, out)); break;
    case 'tuple': n.items.forEach(a => freeVars(a, out)); break;
    case 'matrix': n.rows.flat().forEach(a => freeVars(a, out)); break;
    case 'system': n.eqs.forEach(a => freeVars(a, out)); break;
    case 'integral':
      if (n.lo) bound(n.v, n.a, [n.lo, n.hi]);
      else freeVars(n.a, out);
      break;
    case 'lim': bound(n.v, n.a, [n.to]); break;
    case 'sum': bound(n.v, n.a, [n.from, n.to]); break;
  }
  return out;
}

export function contains(n: Node, pred: (n: Node) => boolean): boolean {
  if (pred(n)) return true;
  switch (n.k) {
    case 'neg': case 'deg': case 'radu': case 'deriv': return contains(n.a, pred);
    case 'bin': case 'eq': case 'rel': return contains(n.a, pred) || contains(n.b, pred);
    case 'fn': return n.args.some(a => contains(a, pred));
    case 'tuple': return n.items.some(a => contains(a, pred));
    case 'matrix': return n.rows.some(r => r.some(a => contains(a, pred)));
    case 'system': return n.eqs.some(a => contains(a, pred));
    case 'integral': return contains(n.a, pred) || (!!n.lo && contains(n.lo, pred)) || (!!n.hi && contains(n.hi, pred));
    case 'lim': return contains(n.a, pred) || contains(n.to, pred);
    case 'sum': return contains(n.a, pred) || contains(n.from, pred) || contains(n.to, pred);
  }
  return false;
}
