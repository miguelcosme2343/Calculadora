// Superficie z = f(x, y) en canvas, con proyección ortográfica.
// Arrastrar gira, pellizcar o la rueda acercan, y los botones cambian el dominio.

const N = 44; // celdas por lado

// Rampa secuencial de un solo tono (azul), de claro a oscuro
const RAMP = ['#cfe1f7', '#9ec3ee', '#6ea4e4', '#3f85d8', '#2a6ec0', '#1f5aa0', '#16467f'];

function rampColor(t: number, light: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = parseInt(RAMP[i].slice(1), 16), b = parseInt(RAMP[i + 1].slice(1), 16);
  const ch = (s: number) => {
    const ca = (a >> s) & 255, cb = (b >> s) & 255;
    return Math.round((ca + (cb - ca) * f) * light);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const fmt = (v: number) => String(+v.toPrecision(3));

export function mountSurface(host: HTMLElement, f: (x: number, y: number) => number, names: [string, string]): { destroy(): void } {
  host.classList.add('plot');
  const wrap = document.createElement('div');
  wrap.className = 'plot-canvas surface';
  const canvas = document.createElement('canvas');
  const controls = document.createElement('div');
  controls.className = 'plot-controls';
  controls.innerHTML = '<button data-z="in" aria-label="Reducir dominio">+</button><button data-z="out" aria-label="Ampliar dominio">−</button><button data-z="reset" aria-label="Vista inicial">⟲</button>';
  const info = document.createElement('div');
  info.className = 'plot-info';
  wrap.append(canvas, controls, info);
  host.append(wrap);
  const ctx = canvas.getContext('2d')!;

  let half = 5; // dominio [-half, half]²
  let yaw = -0.75, pitch = 0.55, zoom = 1;
  let grid: Float64Array = new Float64Array(0);
  let zlo = 0, zhi = 1;

  function sample() {
    grid = new Float64Array((N + 1) * (N + 1));
    const vals: number[] = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -half + (2 * half * i) / N, y = -half + (2 * half * j) / N;
        const v = f(x, y);
        grid[j * (N + 1) + i] = v;
        if (Number.isFinite(v)) vals.push(v);
      }
    }
    vals.sort((a, b) => a - b);
    if (!vals.length) { zlo = -1; zhi = 1; return; }
    // recorte por percentiles: las asíntotas no aplastan el resto
    zlo = vals[Math.floor(vals.length * 0.02)];
    zhi = vals[Math.ceil(vals.length * 0.98) - 1];
    if (zhi - zlo < 1e-9) { zlo -= 1; zhi += 1; }
    info.textContent = `${names[0]}, ${names[1]} ∈ [−${fmt(half)}, ${fmt(half)}] · z ∈ [${fmt(zlo)}, ${fmt(zhi)}]`;
  }

  let W = 0, H = 0;
  function project(x: number, y: number, z: number): [number, number, number] {
    // x, y, z normalizados a [-1, 1]
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const rx = x * cy - y * sy, ry = x * sy + y * cy;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const depth = ry * cp + z * sp;
    const up = z * cp - ry * sp;
    const s = Math.min(W, H) * 0.33 * zoom;
    return [W / 2 + rx * s, H / 2 - up * s, depth];
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    if (rect.width !== W || rect.height !== H) {
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    }
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const style = getComputedStyle(host);
    const cAxis = style.getPropertyValue('--plot-axis').trim() || '#888';
    const cText = style.getPropertyValue('--muted').trim() || '#666';
    const zn = (v: number) => ((Math.max(zlo, Math.min(zhi, v)) - zlo) / (zhi - zlo)) * 1.2 - 0.6;
    const P = (i: number, j: number) => {
      const v = grid[j * (N + 1) + i];
      return Number.isFinite(v) ? project(-1 + (2 * i) / N, -1 + (2 * j) / N, zn(v)) : null;
    };

    // caja de referencia (base y aristas)
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => project(x, y, -0.6));
    ctx.strokeStyle = cAxis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((c, k) => (k ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
    ctx.closePath();
    ctx.stroke();

    // caras ordenadas de atrás adelante
    const faces: { d: number; pts: [number, number, number][]; t: number; light: number }[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
        if (q.some(p => !p)) continue;
        const pts = q as [number, number, number][];
        const vals = [grid[j * (N + 1) + i], grid[j * (N + 1) + i + 1], grid[(j + 1) * (N + 1) + i + 1], grid[(j + 1) * (N + 1) + i]];
        const avg = vals.reduce((s, v) => s + v, 0) / 4;
        // sombreado simple según la pendiente de la cara
        const dzx = zn(vals[1]) - zn(vals[0]) + zn(vals[2]) - zn(vals[3]);
        const dzy = zn(vals[3]) - zn(vals[0]) + zn(vals[2]) - zn(vals[1]);
        const nlen = Math.hypot(dzx * N / 4, dzy * N / 4, 1);
        const light = 0.72 + 0.28 * (1 / nlen);
        faces.push({ d: pts.reduce((s, p) => s + p[2], 0) / 4, pts, t: (avg - zlo) / (zhi - zlo), light });
      }
    }
    faces.sort((a, b) => a.d - b.d);
    ctx.lineWidth = 0.6;
    for (const fc of faces) {
      ctx.beginPath();
      fc.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      const col = rampColor(fc.t, fc.light);
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.fill();
      ctx.stroke();
    }

    // nombres de los ejes
    ctx.fillStyle = cText;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lx = project(1.25, 0, -0.6), ly = project(0, 1.25, -0.6), lz = project(-1, -1, 0.85);
    ctx.fillText(names[0], lx[0], lx[1]);
    ctx.fillText(names[1], ly[0], ly[1]);
    ctx.fillText('z', lz[0], lz[1]);
  }

  let frame = 0;
  const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };

  const pointers = new Map<number, { x: number; y: number }>();
  let last: { x: number; y: number } | null = null;
  let pinch0 = 0, zoom0 = 1;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      zoom0 = zoom;
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoom = Math.max(0.3, Math.min(4, zoom0 * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0)));
    } else if (last) {
      yaw += (e.clientX - last.x) * 0.01;
      pitch = Math.max(-0.2, Math.min(1.5, pitch + (e.clientY - last.y) * 0.01));
      last = { x: e.clientX, y: e.clientY };
    }
    redraw();
  });
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    last = pointers.size ? [...pointers.values()][0] : null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoom = Math.max(0.3, Math.min(4, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    redraw();
  }, { passive: false });
  controls.addEventListener('click', e => {
    const z = (e.target as HTMLElement).closest('button')?.dataset.z;
    if (z === 'in') half /= 2;
    else if (z === 'out') half *= 2;
    else if (z === 'reset') { half = 5; yaw = -0.75; pitch = 0.55; zoom = 1; }
    else return;
    sample();
    redraw();
  });

  sample();
  const ro = new ResizeObserver(redraw);
  ro.observe(wrap);
  redraw();
  return { destroy() { ro.disconnect(); cancelAnimationFrame(frame); host.replaceChildren(); } };
}
