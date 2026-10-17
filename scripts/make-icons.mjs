// Genera public/icon-192.png e icon-512.png (sin dependencias) y public/icon.svg
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [79, 70, 229];
const ANG = (35 * Math.PI) / 180;
const C = 0.5, R = 0.27;
const tip = [C + R * Math.cos(ANG), C - R * Math.sin(ANG)];

const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
};
const inTri = (px, py, [a, b, c]) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const P = [px, py];
  const d1 = s(P, a, b), d2 = s(P, b, c), d3 = s(P, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
// punta de flecha
const hl = 0.09, hw = 0.055;
const ux = Math.cos(ANG), uy = -Math.sin(ANG);
const head = [
  [tip[0] + ux * 0.03, tip[1] + uy * 0.03],
  [tip[0] - ux * hl - uy * hw, tip[1] - uy * hl + ux * hw],
  [tip[0] - ux * hl + uy * hw, tip[1] - uy * hl - ux * hw],
];

// capas: [alpha, rgb] de abajo arriba
function shade(x, y) {
  let col = [...BG];
  const over = (a, rgb) => { col = col.map((c, i) => c * (1 - a) + rgb[i] * a); };
  const d = Math.hypot(x - C, y - C);
  if (Math.abs(d - R) < 0.016) over(0.35, [255, 255, 255]);
  if (segDist(x, y, C, C, C + R, C) < 0.012) over(0.55, [255, 255, 255]);
  const a = Math.atan2(C - y, x - C);
  if (Math.abs(d - 0.13) < 0.014 && a >= 0 && a <= ANG) over(1, [199, 201, 255]);
  if (segDist(x, y, C, C, tip[0] - ux * 0.06, tip[1] - uy * 0.06) < 0.026) over(1, [255, 255, 255]);
  if (inTri(x, y, head)) over(1, [255, 255, 255]);
  if (d < 0.042) over(1, [255, 255, 255]);
  return col;
}

function png(size) {
  const ss = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
        acc = acc.map((v, i) => v + c[i]);
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      acc.forEach((v, i) => { raw[o + i] = Math.round(v / (ss * ss)); });
      raw[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icon-192.png', png(192));
writeFileSync('public/icon-512.png', png(512));

const p = v => (v * 100).toFixed(2);
writeFileSync('public/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="rgb(${BG})"/>
<circle cx="50" cy="50" r="${p(R)}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3.2"/>
<line x1="50" y1="50" x2="${p(C + R)}" y2="50" stroke="#fff" stroke-opacity=".55" stroke-width="2.4"/>
<path d="M ${p(C + 0.13)} 50 A 13 13 0 0 0 ${p(C + 0.13 * Math.cos(ANG))} ${p(C - 0.13 * Math.sin(ANG))}" fill="none" stroke="#c7c9ff" stroke-width="2.8"/>
<line x1="50" y1="50" x2="${p(tip[0] - ux * 0.06)}" y2="${p(tip[1] - uy * 0.06)}" stroke="#fff" stroke-width="5.2" stroke-linecap="round"/>
<polygon points="${head.map(([x, y]) => `${p(x)},${p(y)}`).join(' ')}" fill="#fff"/>
<circle cx="50" cy="50" r="4.2" fill="#fff"/>
</svg>
`);
console.log('iconos generados');
