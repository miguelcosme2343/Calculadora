import { MathfieldElement, convertLatexToMarkup } from 'mathlive';
import 'mathlive/fonts.css';
import 'mathlive/static.css';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import {
  alternatives, calculate, DEFAULT_SETTINGS, formatIntervals, formatMatrix, formatPoly, formatValue, varLatex,
  type Formatted, type Result, type Settings, type Z,
} from './engine';
import { z } from './engine/evaluate';
import { ABC, NUMPAD, PANELS, TOOLS, type Key, type Panel } from './ui/keys';
import { buildSheet } from './ui/solutions';

registerSW({ immediate: true });

MathfieldElement.fontsDirectory = null; // las fuentes las carga fonts.css
MathfieldElement.soundsDirectory = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const markup = (latex: string) => convertLatexToMarkup(latex);

// --- Estado persistente ---
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? { ...fallback, ...JSON.parse(v) } : fallback;
    } catch { return fallback; }
  },
  getRaw(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, v: unknown) {
    try { localStorage.setItem(key, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* sin almacenamiento */ }
  },
};

interface HistoryItem { input: string; result: string; resultText: string }

let settings: Settings = store.get('settings', DEFAULT_SETTINGS);
let history: HistoryItem[] = (() => {
  try { return JSON.parse(store.getRaw('history') ?? '[]'); } catch { return []; }
})();
let ans: Z | null = (() => {
  const a = store.get<{ v?: [number, number] }>('ans', {}).v;
  return a ? z(a[0], a[1]) : null;
})();
let lastResult: Result = { kind: 'empty' };

// --- Editor ---
// Se crea desde aquí (no en el HTML) para que la configuración de fuentes se aplique antes
const mf = new MathfieldElement();
mf.id = 'input';
mf.setAttribute('aria-label', 'Expresión');
$('input-slot').replaceWith(mf);
mf.mathVirtualKeyboardPolicy = 'manual';
mf.smartFence = true;
mf.popoverPolicy = 'off';
mf.menuItems = [];
mf.placeholder = '\\text{Escribe un problema matemático}';
mf.inlineShortcuts = {
  ...mf.inlineShortcuts,
  ang: '\\angle', '||': '\\parallel', ans: '\\operatorname{Ans}', deg: '\\degree',
};
mf.value = store.getRaw('input') ?? '';

mf.addEventListener('input', () => update());
mf.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { ev.preventDefault(); newline(); }
}, { capture: true });

$('btn-clear').addEventListener('click', () => {
  saveHistoryNow();
  mf.value = '';
  entryOpen = false;
  update();
  mf.focus();
});

// --- Cálculo y resultado ---
const answerEl = $('answer');
const altRow = $('alt-row');
const solBtn = $<HTMLButtonElement>('btn-solutions');

function ctx() {
  return { angle: settings.angle, ans, imagUnit: settings.imagUnit };
}

function update() {
  const latex = mf.getValue('latex-unstyled');
  store.set('input', latex);
  lastResult = calculate(latex, ctx());
  render(lastResult);
  scheduleHistory();
}

function line(prefix: string, f: Formatted, copyText = f.text): HTMLElement {
  const b = document.createElement('button');
  b.className = 'answer-line';
  b.title = 'Copiar';
  b.innerHTML = markup(prefix + f.latex);
  b.addEventListener('click', () => copy(copyText));
  return b;
}

function message(text: string, cls: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'answer-msg ' + cls;
  p.textContent = text;
  return p;
}

function render(r: Result) {
  answerEl.replaceChildren();
  altRow.replaceChildren();
  answerEl.className = 'answer';
  let canSolve = true;
  switch (r.kind) {
    case 'empty':
    case 'incomplete':
      canSolve = false;
      break;
    case 'error':
      answerEl.append(message(r.message, 'error'));
      canSolve = false;
      break;
    case 'needsVars':
      answerEl.append(message(`Expresión con ${r.names.join(', ')}. Añade «=» para resolver.`, 'muted'));
      canSolve = false;
      break;
    case 'bool':
      answerEl.append(message(r.value ? '✓ Verdadero' : '✗ Falso', r.value ? 'ok' : 'error'));
      canSolve = false;
      break;
    case 'value': {
      answerEl.append(line('=', formatValue(r.value, settings)));
      const alt = alternatives(r.value, settings)[0];
      if (alt) showAlt(alt);
      break;
    }
    case 'matrix':
      answerEl.append(line('=', formatMatrix(r.value, settings)));
      break;
    case 'poly': {
      const f = formatPoly(r.coeffs, r.variable, settings);
      answerEl.append(r.antiderivative ? line('=', { latex: f.latex + '+C', text: f.text + ' + C' }) : line('=', f));
      break;
    }
    case 'symbolic':
      answerEl.append(line('=', { latex: r.latex, text: r.text }));
      break;
    case 'function': {
      const name = r.name ?? 'f';
      answerEl.append(message(r.vars.length === 2 ? `Función ${name}(${r.vars.join(', ')}): superficie en 3D` : `Función ${name}(${r.vars[0]}): ver su gráfica`, 'muted'));
      break;
    }
    case 'solutions': {
      if (r.identity) { answerEl.append(message('Se cumple para cualquier valor', 'ok')); break; }
      const v = varLatex(r.variable);
      r.roots.forEach((root, k) => {
        const name = r.roots.length > 1 ? `${v}_{${k + 1}}` : v;
        const el = line(`${name}=`, formatValue(root, settings));
        const mult = r.mult?.[k] ?? 1;
        if (mult > 1) {
          const tag = document.createElement('span');
          tag.className = 'mult';
          tag.textContent = mult === 2 ? 'doble' : mult === 3 ? 'triple' : `×${mult}`;
          el.append(tag);
        }
        answerEl.append(el);
      });
      if (!r.roots.length) answerEl.append(message(r.note ?? 'Sin solución', 'muted'));
      else if (r.note) answerEl.append(message(r.note, 'muted small'));
      break;
    }
    case 'system': {
      r.solutions.forEach(sol => {
        const parts = r.vars.map((v, i) => ({ v, f: formatValue(sol[i], settings) }));
        answerEl.append(line('', {
          latex: parts.map(p => `${varLatex(p.v)}=${p.f.latex}`).join(',\\;'),
          text: parts.map(p => `${p.v} = ${p.f.text}`).join('; '),
        }));
      });
      if (r.note) answerEl.append(message(r.note, r.solutions.length ? 'muted small' : 'muted'));
      break;
    }
    case 'inequality':
      answerEl.append(line('', formatIntervals(r.intervals, r.variable, settings)));
      break;
  }
  if (r.note && r.kind !== 'solutions' && r.kind !== 'system') answerEl.append(message(r.note, 'muted small'));
  answerEl.classList.toggle('has-result', answerEl.childElementCount > 0);
  solBtn.hidden = !canSolve;
}

function showAlt(f: Formatted) {
  const label = document.createElement('span');
  label.className = 'alt-label';
  label.textContent = 'Forma alternativa';
  const b = document.createElement('button');
  b.className = 'alt-value';
  b.innerHTML = markup(f.latex);
  b.title = 'Copiar';
  b.addEventListener('click', () => copy(f.text));
  altRow.append(label, b);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado: ' + text);
  } catch {
    toast('No se pudo copiar');
  }
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.hidden = true; }, 1800);
}

// --- Historial automático ---
// Se guarda solo tras unos segundos con un resultado válido. Mientras se sigue editando
// la misma expresión se actualiza la misma entrada en lugar de crear otra.
let entryOpen = false;
let historyTimer = 0;
function scheduleHistory() {
  clearTimeout(historyTimer);
  historyTimer = window.setTimeout(saveHistoryNow, 2500);
}

function summary(r: Result): Formatted | null {
  switch (r.kind) {
    case 'value': {
      const f = formatValue(r.value, settings);
      return { latex: '=' + f.latex, text: f.text };
    }
    case 'poly': {
      const f = formatPoly(r.coeffs, r.variable, settings);
      return { latex: '=' + f.latex + (r.antiderivative ? '+C' : ''), text: f.text };
    }
    case 'symbolic': return { latex: '=' + r.latex, text: r.text };
    case 'matrix': {
      const f = formatMatrix(r.value, settings);
      return { latex: '=' + f.latex, text: f.text };
    }
    case 'inequality': return formatIntervals(r.intervals, r.variable, settings);
    case 'solutions': {
      if (r.identity) return { latex: '\\text{Cualquier valor}', text: 'Cualquier valor' };
      if (!r.roots.length) return { latex: '\\text{Sin solución}', text: 'Sin solución' };
      const fs = r.roots.map(x => formatValue(x, settings));
      return { latex: `${varLatex(r.variable)}=${fs.map(f => f.latex).join(',\\;')}`, text: fs.map(f => f.text).join('; ') };
    }
    case 'system': {
      if (!r.solutions.length) return { latex: `\\text{${r.note ?? 'Sin solución'}}`, text: r.note ?? '' };
      const sol = r.solutions[0];
      return {
        latex: r.vars.map((v, i) => `${varLatex(v)}=${formatValue(sol[i], settings).latex}`).join(',\\;'),
        text: r.vars.map((v, i) => `${v} = ${formatValue(sol[i], settings).text}`).join('; '),
      };
    }
    case 'function': return { latex: '\\text{Función}', text: 'Función' };
  }
  return null;
}

function saveHistoryNow() {
  clearTimeout(historyTimer);
  const r = lastResult;
  const sum = summary(r);
  if (!sum) return;
  const input = mf.getValue('latex-unstyled');
  const single = r.kind === 'value' ? r.value : r.kind === 'solutions' && r.roots.length === 1 ? r.roots[0] : null;
  if (single) {
    ans = single;
    store.set('ans', { v: [single.re, single.im] });
  }
  const item = { input, result: sum.latex, resultText: sum.text };
  if (entryOpen && history.length) history[0] = item;
  else if (history[0]?.input !== input) history.unshift(item);
  entryOpen = true;
  history = history.slice(0, 200);
  store.set('history', history);
}

// --- Teclado ---
const keyboard = $('keyboard');
const popover = $('popover');
let activePanel = store.getRaw('panel') ?? PANELS[0].id;
let abcOn = false;
let narrowView: 'num' | 'panel' = 'num';

function keyButton(k: Key): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'key ' + (k.cls ?? '');
  if (k.title) { b.title = k.title; b.setAttribute('aria-label', k.title); }
  if ('blank' in k) { b.disabled = true; b.classList.add('blank'); return b; }
  if ('imag' in k) b.dataset.imag = '';
  if ('decimal' in k) b.dataset.decimal = '';
  setLabel(b, keyLabel(k));
  if (k.alts?.length) b.classList.add('has-alts');

  let longTimer = 0;
  let longFired = false;
  b.addEventListener('pointerdown', ev => {
    ev.preventDefault(); // el editor no pierde el foco
    b.classList.add('pressed');
    longFired = false;
    if (k.alts?.length) {
      // con alternativas: se escribe al soltar, y si se mantiene se abren las alternativas
      longTimer = window.setTimeout(() => { longFired = true; openPopover(b, k.alts!); }, 380);
    } else {
      press(k);
      if ('cmd' in k && k.cmd === 'back') startRepeat(k);
    }
  });
  const finish = (ev: PointerEvent, commit: boolean) => {
    b.classList.remove('pressed');
    stopRepeat();
    clearTimeout(longTimer);
    if (!k.alts?.length || !commit) return;
    if (!longFired) { press(k); return; }
    // deslizar hasta una alternativa y soltar la elige
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.popover .key');
    if (target) target.dispatchEvent(new Event('choose'));
  };
  b.addEventListener('pointerup', ev => finish(ev, true));
  b.addEventListener('pointercancel', ev => finish(ev, false));
  b.addEventListener('pointerleave', ev => { if (!longFired) { b.classList.remove('pressed'); stopRepeat(); clearTimeout(longTimer); } void ev; });
  b.addEventListener('contextmenu', ev => ev.preventDefault());
  return b;
}

function keyLabel(k: Key): string {
  if ('imag' in k) return `$${settings.imagUnit}$`;
  if ('decimal' in k) return settings.decimalComma ? ',' : '.';
  return k.label;
}

function setLabel(b: HTMLElement, label: string) {
  if (label.startsWith('$')) b.innerHTML = markup(label.slice(1, -1));
  else b.innerHTML = label;
}

function openPopover(anchor: HTMLElement, alts: Key[]) {
  popover.replaceChildren(...alts.map(a => {
    const b = document.createElement('button');
    b.className = 'key';
    setLabel(b, keyLabel(a));
    const choose = () => { closePopover(); press(a); };
    b.addEventListener('choose', choose);
    b.addEventListener('pointerdown', ev => { ev.preventDefault(); choose(); });
    return b;
  }));
  popover.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = popover.offsetWidth, ph = popover.offsetHeight;
  popover.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
  popover.style.top = Math.max(8, r.top - ph - 8) + 'px';
}
function closePopover() { popover.hidden = true; }
document.addEventListener('pointerdown', ev => {
  if (!popover.hidden && !(ev.target as HTMLElement).closest('.popover, .has-alts')) closePopover();
});

let repeatTimer = 0;
function startRepeat(k: Key) {
  stopRepeat();
  repeatTimer = window.setTimeout(function tick() {
    press(k);
    repeatTimer = window.setTimeout(tick, 70);
  }, 450);
}
function stopRepeat() { clearTimeout(repeatTimer); }

function press(k: Key) {
  if (!mf.hasFocus()) mf.focus();
  if ('cmd' in k) {
    switch (k.cmd) {
      case 'back': mf.executeCommand('deleteBackward'); break;
      case 'left': mf.executeCommand('moveToPreviousChar'); break;
      case 'right': mf.executeCommand('moveToNextChar'); break;
      case 'newline': newline(); break;
      case 'history': openHistory(); return;
      case 'abc': toggleAbc(); return;
    }
    update();
    return;
  }
  if ('imag' in k) mf.insert(settings.imagUnit, { focus: true, scrollIntoView: true });
  else if ('decimal' in k) mf.insert(settings.decimalComma ? '{,}' : '.', { focus: true, scrollIntoView: true });
  else if ('typed' in k) mf.executeCommand(['typedText', k.typed]);
  else if ('exec' in k) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!mf.executeCommand(k.exec as any)) toast('Pon el cursor dentro de una matriz');
  }
  else if ('insert' in k) mf.insert(k.insert, { focus: true, scrollIntoView: true, selectionMode: 'placeholder', format: 'latex' });
  update();
}

// ↵: nueva línea. Dentro de una matriz añade una fila; si no, convierte la expresión en un sistema.
function newline() {
  const v = mf.getValue('latex-unstyled');
  if (v.startsWith('\\begin{cases}')) {
    mf.executeCommand('addRowAfter');
  } else if (v.includes('\\begin{') && (mf.executeCommand('addRowAfter'), mf.getValue('latex-unstyled') !== v)) {
    // el cursor estaba dentro de una matriz: ya se añadió la fila
  } else {
    mf.value = `\\begin{cases}${v || '\\placeholder{}'}\\\\\\placeholder{}\\end{cases}`;
    mf.executeCommand('moveToMathfieldEnd');
    mf.executeCommand('moveToPreviousPlaceholder');
  }
  mf.focus();
  update();
}

// Fila de herramientas
const tools = $('tools');
TOOLS.forEach(k => {
  const b = keyButton(k);
  if ('cmd' in k && k.cmd === 'abc') b.id = 'tool-abc';
  tools.append(b);
});

// Teclado numérico
const numpad = $('numpad');
NUMPAD.forEach(k => numpad.append(keyButton(k)));

// Pestañas: «+−×÷» solo se ve en modo estrecho (en ancho el numérico está siempre a la derecha)
const tabs = $('tabs');
const panelEl = $('panel');
const numTab = tabButton('+ −<br>× ÷', () => { abcOn = false; narrowView = 'num'; layout(); });
numTab.classList.add('num-tab');
tabs.append(numTab);
const panelTabs = PANELS.map(p => {
  const t = tabButton(p.name, () => { abcOn = false; activePanel = p.id; narrowView = 'panel'; store.set('panel', p.id); layout(); });
  t.dataset.panel = p.id;
  tabs.append(t);
  return t;
});

function tabButton(html: string, onPress: () => void): HTMLButtonElement {
  const t = document.createElement('button');
  t.className = 'tab';
  t.innerHTML = html;
  t.setAttribute('role', 'tab');
  t.addEventListener('pointerdown', ev => { ev.preventDefault(); onPress(); });
  return t;
}

function toggleAbc() {
  abcOn = !abcOn;
  if (abcOn) narrowView = 'panel';
  layout();
}

let renderedPanel = '';
function layout() {
  const p: Panel = abcOn ? ABC : PANELS.find(x => x.id === activePanel) ?? PANELS[0];
  if (renderedPanel !== p.id) {
    panelEl.replaceChildren(...p.keys.map(keyButton));
    panelEl.style.setProperty('--cols', String(p.cols));
    renderedPanel = p.id;
  }
  keyboard.classList.toggle('show-num', narrowView === 'num' && !abcOn);
  numTab.classList.toggle('active', narrowView === 'num' && !abcOn);
  panelTabs.forEach(t => t.classList.toggle('active', !abcOn && t.dataset.panel === activePanel));
  $('tool-abc').classList.toggle('active', abcOn);
}
layout();

// --- Barra de modos ---
const NOTATIONS: Settings['notation'][] = ['auto', 'fixed', 'sci', 'eng'];
const NOTATION_LABEL = { auto: 'Auto', fixed: 'Fija', sci: 'Cient.', eng: 'Ing.' };

function applySettings(next: Partial<Settings>) {
  settings = { ...settings, ...next };
  store.set('settings', settings);
  $('mode-angle').textContent = settings.angle === 'deg' ? 'DEG' : 'RAD';
  $('mode-complex').textContent = settings.complexForm === 'polar' ? 'Polar' : 'Rect.';
  $('mode-notation').textContent = NOTATION_LABEL[settings.notation];
  document.querySelectorAll<HTMLElement>('[data-imag]').forEach(b => setLabel(b, `$${settings.imagUnit}$`));
  document.querySelectorAll<HTMLElement>('[data-decimal]').forEach(b => setLabel(b, settings.decimalComma ? ',' : '.'));
  update();
  if (!sheet.hidden) fillSheet();
}

const tap = (id: string, f: () => void) => $(id).addEventListener('click', f);
tap('mode-angle', () => applySettings({ angle: settings.angle === 'deg' ? 'rad' : 'deg' }));
tap('mode-complex', () => applySettings({ complexForm: settings.complexForm === 'polar' ? 'rect' : 'polar' }));
tap('mode-notation', () => applySettings({ notation: NOTATIONS[(NOTATIONS.indexOf(settings.notation) + 1) % NOTATIONS.length] }));

// --- Ajustes ---
const dialog = $<HTMLDialogElement>('settings');
const form = dialog.querySelector('form')!;
tap('btn-settings', () => {
  for (const [k, v] of Object.entries(settings)) {
    const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v as boolean;
    else el.value = String(v);
  }
  dialog.showModal();
});
form.addEventListener('change', () => {
  const num = (name: string, min: number, max: number, def: number) => {
    const n = Math.round(Number((form.elements.namedItem(name) as HTMLInputElement).value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const val = (name: string) => (form.elements.namedItem(name) as HTMLSelectElement).value;
  const chk = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).checked;
  applySettings({
    notation: val('notation') as Settings['notation'],
    sig: num('sig', 1, 15, settings.sig),
    decimals: num('decimals', 0, 12, settings.decimals),
    engPrefix: chk('engPrefix'),
    fractions: chk('fractions'),
    decimalComma: chk('decimalComma'),
    complexForm: val('complexForm') as Settings['complexForm'],
    angle: val('angle') as Settings['angle'],
    imagUnit: val('imagUnit') as Settings['imagUnit'],
  });
});
dialog.addEventListener('click', ev => { if (ev.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => mf.focus());

// --- Historial ---
const drawer = $('history');
const list = $('history-list');
function renderHistory() {
  list.replaceChildren(...history.map(h => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.innerHTML = `<span class="h-in">${markup(h.input)}</span><span class="h-out">${markup(h.result)}</span>`;
    b.addEventListener('click', () => {
      saveHistoryNow();
      mf.value = h.input;
      entryOpen = false;
      closeHistory();
      update();
    });
    li.append(b);
    return li;
  }));
  $('history-empty').hidden = history.length > 0;
}
function openHistory() {
  if (!drawer.hidden) return closeHistory();
  saveHistoryNow();
  renderHistory();
  drawer.hidden = false;
}
function closeHistory() { drawer.hidden = true; mf.focus(); }
tap('history-close', closeHistory);
tap('history-clear', () => {
  history = [];
  entryOpen = false;
  store.set('history', history);
  renderHistory();
});

// --- Panel de soluciones ---
const sheet = $('sheet');
const sheetBody = $('sheet-body');
let sheetCleanup: (() => void) | null = null;

function fillSheet() {
  sheetCleanup?.();
  const built = buildSheet(lastResult, {
    settings,
    ctx: { angle: settings.angle, ans },
    copy,
    setDefault: patch => {
      applySettings(patch);
      toast('Formato predeterminado actualizado');
    },
  });
  sheetBody.replaceChildren(...built.nodes);
  sheetCleanup = built.destroy;
}
function openSheet() {
  saveHistoryNow();
  fillSheet();
  sheet.hidden = false;
  sheetBody.scrollTop = 0;
  // el botón «atrás» de Android cierra el panel
  history_.pushState({ sheet: true }, '');
}
function closeSheet(fromPop = false) {
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheetCleanup?.();
  sheetCleanup = null;
  if (!fromPop && history_.state?.sheet) history_.back();
  mf.focus();
}
const history_ = window.history;
solBtn.addEventListener('click', openSheet);
tap('sheet-close', () => closeSheet());
sheet.addEventListener('click', ev => { if (ev.target === sheet) closeSheet(); });
window.addEventListener('popstate', () => closeSheet(true));

applySettings({});
requestAnimationFrame(() => mf.focus());
