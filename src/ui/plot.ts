// Gráfica 2D en canvas: curvas y = f(x), curvas implícitas F(x, y) = 0, flechas (fasores),
// puntos destacados y tramos sombreados. Arrastrar desplaza, pellizcar o la rueda hacen zoom,
// tocar (o pasar el ratón) muestra los valores.

export interface Curve { f: (x: number) => number; label: string; color: string }
export interface Implicit { F: (x: number, y: number) => number; label: string; color: string }
export interface Marker { x: number; y: number; label?: string }
export interface Arrow { x0: number; y0: number; x1: number; y1: number; color: string; label?: string; faded?: boolean }
export interface Band { lo: number; hi: number }

export interface PlotSpec {
  curves?: Curve[];
  implicits?: Implicit[];
  markers?: Marker[];
  arrows?: Arrow[];
  bands?: Band[];
  equal?: boolean; // misma escala en ambos ejes (plano complejo, curvas implícitas)
  axisNames?: [string, string];
  formatValue?: (v: number) => string;
}

interface View { xmin: number; xmax: number; ymin: number; ymax: number }

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

function tick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-6) return '0';
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  if (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3)) return v.toExponential(1).replace('e+', 'e');
  return v.toFixed(Math.min(6, d));
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

function initialView(spec: PlotSpec): View {
  const pts: [number, number][] = [];
  spec.markers?.forEach(m => pts.push([m.x, m.y]));
  spec.arrows?.forEach(a => { pts.push([a.x0, a.y0], [a.x1, a.y1]); });
  let xmin = -10, xmax = 10;
  if (spec.arrows?.length) {
    pts.push([0, 0]);
    xmin = Math.min(...pts.map(p => p[0])); xmax = Math.max(...pts.map(p => p[0]));
  } else if (spec.markers?.length) {
    const xs = spec.markers.map(m => m.x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const pad = Math.max(2, (hi - lo) * 0.6);
    xmin = lo - pad; xmax = hi + pad;
  }
  if (spec.bands?.length) {
    const ends = spec.bands.flatMap(b => [b.lo, b.hi]).filter(Number.isFinite);
    if (ends.length) {
      const lo = Math.min(...ends, xmin), hi = Math.max(...ends, xmax);
      const pad = Math.max(2, (hi - lo) * 0.25);
      xmin = Math.min(xmin, lo - pad); xmax = Math.max(xmax, hi + pad);
    }
  }
  let ymin = Infinity, ymax = -Infinity;
  if (spec.curves?.length) {
    const ys: number[] = [];
    for (const c of spec.curves) {
      for (let i = 0; i <= 400; i++) {
        const y = c.f(xmin + ((xmax - xmin) * i) / 400);
        if (Number.isFinite(y)) ys.push(y);
      }
    }
    ys.sort((a, b) => a - b);
    if (ys.length) { ymin = percentile(ys, 0.04); ymax = percentile(ys, 0.96); }
  }
  pts.forEach(([, y]) => { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); });
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) { ymin = -10; ymax = 10; }
  if (ymax - ymin < 1e-9) { ymin -= 1; ymax += 1; }
  const padY = (ymax - ymin) * 0.18;
  ymin -= padY; ymax += padY;
  if (spec.arrows?.length) {
    const padX = (xmax - xmin) * 0.18 || 1;
    xmin -= padX; xmax += padX;
  }
  // que se vean los ejes si quedan cerca
  if (ymin > 0 && ymin < (ymax - ymin) * 0.5) ymin = -(ymax - ymin) * 0.06;
  if (ymax < 0 && -ymax < (ymax - ymin) * 0.5) ymax = (ymax - ymin) * 0.06;
  return { xmin, xmax, ymin, ymax };
}

export function mountPlot(host: HTMLElement, spec: PlotSpec): { destroy(): void } {
  host.classList.add('plot');
  const series = [...(spec.curves ?? []), ...(spec.implicits ?? [])];
  if (series.length >= 2) {
    const legend = document.createElement('div');
    legend.className = 'plot-legend';
    for (const s of series) {
      const item = document.createElement('span');
      item.innerHTML = `<i style="background:${s.color}"></i>`;
      item.append(s.label);
      legend.append(item);
    }
    host.append(legend);
  }
  const wrap = document.createElement('div');
  wrap.className = 'plot-canvas';
  const canvas = document.createElement('canvas');
  const tip = document.createElement('div');
  tip.className = 'plot-tip';
  tip.hidden = true;
  const controls = document.createElement('div');
  controls.className = 'plot-controls';
  controls.innerHTML = '<button data-z="in" aria-label="Acercar">+</button><button data-z="out" aria-label="Alejar">−</button><button data-z="reset" aria-label="Vista inicial">⟲</button>';
  wrap.append(canvas, tip, controls);
  host.append(wrap);

  const fmt = spec.formatValue ?? ((v: number) => String(+v.toPrecision(6)));
  const ctx = canvas.getContext('2d')!;
  let W = 0, H = 0;
  const home = initialView(spec);
  let view: View = { ...home };
  let traceX: number | null = null;
  let coarse = false;
  let idleTimer = 0;

  const css = (name: string, fallback: string) => getComputedStyle(host).getPropertyValue(name).trim() || fallback;
  // el canvas no entiende var(--x): se resuelve aquí
  const col = (c: string) => (c.startsWith('var(') ? css(c.slice(4, -1), '#888') : c);

  function fitAspect() {
    if (!spec.equal || !W || !H) return;
    // misma escala: se amplía el eje que haga falta alrededor del centro
    const sx = (view.xmax - view.xmin) / W, sy = (view.ymax - view.ymin) / H;
    const s = Math.max(sx, sy);
    const cx = (view.xmin + view.xmax) / 2, cy = (view.ymin + view.ymax) / 2;
    view = { xmin: cx - (s * W) / 2, xmax: cx + (s * W) / 2, ymin: cy - (s * H) / 2, ymax: cy + (s * H) / 2 };
  }

  const X = (x: number) => ((x - view.xmin) / (view.xmax - view.xmin)) * W;
  const Y = (y: number) => H - ((y - view.ymin) / (view.ymax - view.ymin)) * H;
  const invX = (px: number) => view.xmin + (px / W) * (view.xmax - view.xmin);
  const invY = (py: number) => view.ymin + ((H - py) / H) * (view.ymax - view.ymin);

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    if (rect.width !== W || rect.height !== H) {
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      fitAspect();
    }
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cGrid = css('--plot-grid', '#e5e5ea'), cAxis = css('--plot-axis', '#8a8a96');
    const cText = css('--muted', '#666'), cInk = css('--text', '#111'), cSurface = css('--surface', '#fff');
    const cBand = css('--plot-band', 'rgba(79,70,229,0.12)'), cAccent = css('--accent', '#4f46e5');
    ctx.font = '11px system-ui, sans-serif';

    // tramos sombreados (soluciones de desigualdades)
    for (const b of spec.bands ?? []) {
      const x0 = Math.max(0, X(b.lo)), x1 = Math.min(W, X(b.hi));
      if (x1 <= x0) continue;
      ctx.fillStyle = cBand;
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.fillStyle = cAccent;
      ctx.fillRect(x0, Math.min(H - 2, Math.max(0, Y(0))) - 2, x1 - x0, 4);
    }

    // rejilla y ejes
    const sx = niceStep(view.xmax - view.xmin, W / 90), sy = niceStep(view.ymax - view.ymin, H / 70);
    ctx.lineWidth = 1;
    ctx.strokeStyle = cGrid;
    ctx.beginPath();
    for (let x = Math.ceil(view.xmin / sx) * sx; x <= view.xmax; x += sx) { const p = Math.round(X(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
    for (let y = Math.ceil(view.ymin / sy) * sy; y <= view.ymax; y += sy) { const p = Math.round(Y(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
    const ax = Math.min(W - 1, Math.max(0, X(0))), ay = Math.min(H - 1, Math.max(0, Y(0)));
    ctx.strokeStyle = cAxis;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(ay) + 0.5); ctx.lineTo(W, Math.round(ay) + 0.5);
    ctx.moveTo(Math.round(ax) + 0.5, 0); ctx.lineTo(Math.round(ax) + 0.5, H);
    ctx.stroke();
    ctx.fillStyle = cText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const lyTop = ay + 4 > H - 14 ? ay - 16 : ay + 4;
    for (let x = Math.ceil(view.xmin / sx) * sx; x <= view.xmax; x += sx) {
      if (Math.abs(x) < sx / 2) continue;
      ctx.fillText(tick(x, sx), X(x), lyTop);
    }
    ctx.textAlign = ax > W - 40 ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(view.ymin / sy) * sy; y <= view.ymax; y += sy) {
      if (Math.abs(y) < sy / 2) continue;
      ctx.fillText(tick(y, sy), ax > W - 40 ? ax - 4 : ax + 4, Y(y));
    }
    if (spec.axisNames) {
      ctx.fillStyle = cText;
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(spec.axisNames[0], W - 4, ay - 3);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(spec.axisNames[1], ax + 5, 4);
    }

    // curvas y = f(x)
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const c of spec.curves ?? []) {
      ctx.strokeStyle = col(c.color);
      ctx.beginPath();
      let pen = false, lastY = 0;
      const step = coarse ? 2 : 1;
      for (let px = 0; px <= W; px += step) {
        const y = c.f(invX(px));
        if (!Number.isFinite(y)) { pen = false; continue; }
        const py = Y(y);
        // salto vertical enorme: asíntota, no se une
        if (pen && Math.abs(py - lastY) > H * 1.5) pen = false;
        const cy = Math.max(-H, Math.min(2 * H, py));
        if (pen) ctx.lineTo(px, cy); else ctx.moveTo(px, cy);
        pen = true;
        lastY = py;
      }
      ctx.stroke();
    }

    // curvas implícitas F(x, y) = 0 por marching squares
    for (const imp of spec.implicits ?? []) drawImplicit(imp, coarse ? 12 : 5);

    // flechas (fasores)
    for (const a of spec.arrows ?? []) drawArrow(a, cInk);

    // puntos destacados
    for (const m of spec.markers ?? []) {
      const px = X(m.x), py = Y(m.y);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = cInk;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cSurface;
      ctx.stroke();
      if (m.label) {
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = px > W - 90 ? 'right' : 'left';
        ctx.textBaseline = 'bottom';
        const tx = px > W - 90 ? px - 8 : px + 8;
        ctx.lineWidth = 3;
        ctx.strokeStyle = cSurface;
        ctx.strokeText(m.label, tx, py - 6);
        ctx.fillStyle = cInk;
        ctx.fillText(m.label, tx, py - 6);
        ctx.font = '11px system-ui, sans-serif';
      }
    }

    drawTrace(cAxis, cSurface);
  }

  function drawArrow(a: Arrow, cInk: string) {
    const x0 = X(a.x0), y0 = Y(a.y0), x1 = X(a.x1), y1 = Y(a.y1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    ctx.globalAlpha = a.faded ? 0.55 : 1;
    ctx.strokeStyle = col(a.color);
    ctx.fillStyle = col(a.color);
    ctx.lineWidth = a.faded ? 2 : 3;
    if (len > 1) {
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      const head = Math.min(12, len * 0.4);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1 - ux * head * 0.8, y1 - uy * head * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - ux * head - uy * head * 0.45, y1 - uy * head + ux * head * 0.45);
      ctx.lineTo(x1 - ux * head + uy * head * 0.45, y1 - uy * head - ux * head * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (a.label) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = cInk;
      ctx.fillText(a.label, x1 + 6, y1 - 8);
      ctx.font = '11px system-ui, sans-serif';
    }
  }

  function drawImplicit(imp: Implicit, cell: number) {
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
    const v = new Float64Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      const y = invY(j * cell);
      for (let i = 0; i < cols; i++) v[j * cols + i] = imp.F(invX(i * cell), y);
    }
    ctx.strokeStyle = col(imp.color);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const interp = (a: number, b: number) => (Math.abs(a - b) < 1e-300 ? 0.5 : a / (a - b));
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = v[j * cols + i], b = v[j * cols + i + 1], c = v[(j + 1) * cols + i + 1], d = v[(j + 1) * cols + i];
        if (![a, b, c, d].every(Number.isFinite)) continue;
        const x = i * cell, y = j * cell;
        const pts: [number, number][] = [];
        if ((a > 0) !== (b > 0)) pts.push([x + interp(a, b) * cell, y]);
        if ((b > 0) !== (c > 0)) pts.push([x + cell, y + interp(b, c) * cell]);
        if ((d > 0) !== (c > 0)) pts.push([x + interp(d, c) * cell, y + cell]);
        if ((a > 0) !== (d > 0)) pts.push([x, y + interp(a, d) * cell]);
        if (pts.length < 2) continue;
        // un polo también cambia de signo: se descarta si F no es pequeña en medio
        const mx = (pts[0][0] + pts[1][0]) / 2, my = (pts[0][1] + pts[1][1]) / 2;
        const fm = Math.abs(imp.F(invX(mx), invY(my)));
        if (!(fm <= Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)))) continue;
        ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]);
        if (pts.length === 4) { ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); }
      }
    }
    ctx.stroke();
  }

  function drawTrace(cAxis: string, cSurface: string) {
    const curves = spec.curves ?? [];
    if (traceX === null || !curves.length) { tip.hidden = true; return; }
    const px = X(traceX);
    if (px < 0 || px > W) { tip.hidden = true; return; }
    ctx.strokeStyle = cAxis;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    ctx.setLineDash([]);
    const rows: string[] = [`<b>x = ${fmt(traceX)}</b>`];
    for (const c of curves) {
      const y = c.f(traceX);
      if (Number.isFinite(y)) {
        ctx.beginPath();
        ctx.arc(px, Y(y), 5, 0, Math.PI * 2);
        ctx.fillStyle = col(c.color); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = cSurface; ctx.stroke();
      }
      rows.push(`<span><i style="background:${c.color}"></i>${c.label} = ${Number.isFinite(y) ? fmt(y) : 'no definida'}</span>`);
    }
    tip.innerHTML = rows.join('');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = (px + 12 + tw > W ? px - 12 - tw : px + 12) + 'px';
    tip.style.top = '8px';
  }

  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };
  // durante el gesto se dibuja más rápido (menos resolución en curvas implícitas)
  const interacting = () => {
    coarse = true;
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => { coarse = false; redraw(); }, 180);
  };

  function zoomAt(px: number, py: number, k: number) {
    const x = invX(px), y = invY(py);
    view = {
      xmin: x - (x - view.xmin) * k, xmax: x + (view.xmax - x) * k,
      ymin: y - (y - view.ymin) * k, ymax: y + (view.ymax - y) * k,
    };
    interacting();
    redraw();
  }

  // --- gestos ---
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { view: View; pts: { x: number; y: number }[] } | null = null;
  let moved = false;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    start = { view: { ...view }, pts: [...pointers.values()].map(p => ({ ...p })) };
    moved = false;
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && spec.curves?.length) { traceX = invX(p.x); redraw(); }
      return;
    }
    pointers.set(e.pointerId, p);
    if (!start) return;
    const pts = [...pointers.values()];
    const v0 = start.view;
    const sx = (v0.xmax - v0.xmin) / W, sy = (v0.ymax - v0.ymin) / H;
    if (pts.length === 1 && start.pts.length === 1) {
      const dx = pts[0].x - start.pts[0].x, dy = pts[0].y - start.pts[0].y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      view = { xmin: v0.xmin - dx * sx, xmax: v0.xmax - dx * sx, ymin: v0.ymin + dy * sy, ymax: v0.ymax + dy * sy };
    } else if (pts.length >= 2 && start.pts.length >= 2) {
      moved = true;
      const d0 = Math.hypot(start.pts[0].x - start.pts[1].x, start.pts[0].y - start.pts[1].y);
      const d1 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = d0 / Math.max(1, d1);
      const m0 = { x: (start.pts[0].x + start.pts[1].x) / 2, y: (start.pts[0].y + start.pts[1].y) / 2 };
      const m1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const cx = v0.xmin + m0.x * sx, cy = v0.ymin + (H - m0.y) * sy;
      const nsx = sx * k, nsy = sy * k;
      view = {
        xmin: cx - m1.x * nsx, xmax: cx + (W - m1.x) * nsx,
        ymin: cy - (H - m1.y) * nsy, ymax: cy + m1.y * nsy,
      };
    }
    interacting();
    redraw();
  });
  const end = (e: PointerEvent) => {
    const wasTap = !moved && pointers.size === 1 && start?.pts.length === 1;
    pointers.delete(e.pointerId);
    if (wasTap && spec.curves?.length) {
      const p = local(e);
      traceX = traceX !== null && Math.abs(X(traceX) - p.x) < 6 ? null : invX(p.x);
      redraw();
    }
    start = pointers.size ? { view: { ...view }, pts: [...pointers.values()].map(q => ({ ...q })) } : null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse' && !pointers.size) { traceX = null; redraw(); }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = { x: e.offsetX, y: e.offsetY };
    zoomAt(p.x, p.y, e.deltaY > 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { view = { ...home }; fitAspect(); redraw(); });
  controls.addEventListener('click', e => {
    const z = (e.target as HTMLElement).closest('button')?.dataset.z;
    if (z === 'in') zoomAt(W / 2, H / 2, 1 / 1.5);
    else if (z === 'out') zoomAt(W / 2, H / 2, 1.5);
    else if (z === 'reset') { view = { ...home }; fitAspect(); redraw(); }
  });

  const ro = new ResizeObserver(redraw);
  ro.observe(wrap);
  redraw();
  return {
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(frame);
      host.replaceChildren();
    },
  };
}
