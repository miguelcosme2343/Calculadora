// Resultados simbólicos (derivadas) usando math.js. Los ángulos van en radianes.
import * as m from 'mathjs';
import type { MathNode } from 'mathjs';
import { evaluate, EvalError, type EvalContext } from './evaluate';
import { freeVars, type Node } from './parser';

export class NotSymbolic extends Error {}

// Las variables llevan prefijo para no chocar con constantes de math.js (phi, tau, e…)
const sym = (name: string) => 'v_' + name.replace(/[^a-zA-Z0-9_]/g, '');

const SAME = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'acot', 'asec', 'acsc',
  'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch', 'asinh', 'acosh', 'atanh', 'acoth', 'asech', 'acsch',
  'exp', 'sqrt', 'abs',
]);

function num(v: number): string {
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '(-Infinity)';
  return v < 0 ? `(${v})` : String(v);
}

export function toMath(n: Node, ctx: EvalContext): string {
  const r = (x: Node) => toMath(x, ctx);
  switch (n.k) {
    case 'num': return num(n.v);
    case 'const': return n.name;
    case 'var': return sym(n.name);
    case 'ans': {
      if (!ctx.ans) throw new EvalError('Todavía no hay un resultado anterior (Ans)');
      return `(${num(ctx.ans.re)} + ${num(ctx.ans.im)} * i)`;
    }
    case 'neg': return `(-(${r(n.a)}))`;
    case 'deg': return `((${r(n.a)}) * pi / 180)`;
    case 'radu': return r(n.a);
    case 'bin':
      switch (n.op) {
        case '+': case '-': case '*': case '/': case '^': return `((${r(n.a)}) ${n.op} (${r(n.b)}))`;
        case 'par': return `((${r(n.a)}) * (${r(n.b)}) / ((${r(n.a)}) + (${r(n.b)})))`;
        default: throw new NotSymbolic();
      }
    case 'fn': {
      const [a, b] = n.args.map(r);
      if (SAME.has(n.name)) return `${n.name}(${a})`;
      if (n.name === 'ln') return `log(${a})`;
      if (n.name === 'log') return `log10(${a})`;
      if (n.name === 'logb') return `(log(${b}) / log(${a}))`;
      if (n.name === 'root') return `((${b}) ^ (1 / (${a})))`;
      throw new NotSymbolic();
    }
    case 'deriv': {
      let expr: MathNode = m.parse(r(n.a));
      for (let i = 0; i < n.order; i++) expr = m.derivative(expr, sym(n.v));
      return `(${expr.toString()})`;
    }
    case 'integral': case 'lim': case 'sum': {
      // con todas sus variables ligadas es solo un número
      if (freeVars(n).size > 0) throw new NotSymbolic();
      const v = evaluate(n, ctx);
      return `(${num(v.re)} + ${num(v.im)} * i)`;
    }
  }
  throw new NotSymbolic();
}

function constTex(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(+v.toPrecision(6));
}

export function texOf(node: MathNode, imagUnit: 'i' | 'j', varTex: (name: string) => string): string {
  return node.toTex({
    parenthesis: 'auto',
    implicit: 'hide',
    handler: (nd: MathNode) => {
      if (m.isSymbolNode(nd)) {
        if (nd.name.startsWith('v_')) return ' ' + varTex(nd.name.slice(2)) + ' ';
        if (nd.name === 'i') return imagUnit;
      }
      if (m.isConstantNode(nd) && typeof nd.value === 'number' && !Number.isInteger(nd.value)) return constTex(nd.value);
      return undefined;
    },
  });
}

export function textOf(node: MathNode): string {
  return node.toString({ implicit: 'hide' }).replace(/\bv_([a-zA-Z0-9_]+)/g, '$1');
}

// Simplifica la expresión completa (con derivadas ya resueltas)
export function symbolic(n: Node, ctx: EvalContext): MathNode {
  try {
    return m.simplify(m.parse(toMath(n, ctx)));
  } catch (e) {
    if (e instanceof NotSymbolic || e instanceof EvalError) throw e;
    throw new NotSymbolic((e as Error).message);
  }
}
