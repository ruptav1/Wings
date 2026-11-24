import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const B = path.resolve(here, '..');
const fullSvg = fs.readFileSync(path.join(B, 'wings.svg'), 'utf8');
const smallSvg = fs.readFileSync(path.join(B, 'wings-small.svg'), 'utf8');

function swap(svg, [c0, c1, c2], w1 = '#FFFFFF', w2 = '#DCEAF8') {
  return svg
    .replace('#9C1450', c0)
    .replace('#C4467F', c1)
    .replace('#E08AAE', c2)
    .replace('fill="#FFFFFF"', `fill="${w1}"`)
    .replace('fill="#DCEAF8"', `fill="${w2}"`);
}

const variants = [
  { name: 'Hiện tại (tối)',       bg: ['#9C1450', '#C4467F', '#E08AAE'], w1: '#FFFFFF', w2: '#DCEAF8' },
  { name: 'B1 · Sáng vừa (Rose)', bg: ['#C93275', '#E86DA4', '#F8B2CE'], w1: '#FFFFFF', w2: '#E4F1FD' },
  { name: 'B2 · Sáng tươi (Sakura)', bg: ['#D94485', '#F27EB2', '#FBC4DC'], w1: '#FFFFFF', w2: '#E6F2FE' },
  { name: 'B3 · Pastel sáng (cánh đỏ thẫm)', bg: ['#FAD0E2', '#FDE7F0', '#EDF4FC'], w1: '#B5175E', w2: '#DF558F' },
];

const u = (s) => 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
body{margin:0;padding:28px;font-family:"Segoe UI",system-ui,sans-serif;background:#f5f4f2;color:#1b1b22}
h1{margin:0 0 18px;font-size:20px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.card{background:#fff;border:1px solid #e4e1dd;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px}
.card h2{margin:0;font-size:13px}
.row{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.dark{background:#1f212d;padding:10px 12px;border-radius:10px}
.code{font-family:Consolas,monospace;font-size:11px;color:#666}
</style></head><body>
<h1>So sánh độ sáng nền icon Wings (Sōyoku Kamon)</h1>
<div class="grid">
${variants.map(v => {
  const f = swap(fullSvg, v.bg, v.w1, v.w2);
  const s = swap(smallSvg, v.bg, v.w1, v.w2);
  return `<div class="card">
    <h2>${v.name}</h2>
    <div class="code">${v.bg.join(' → ')}</div>
    <img src="${u(f)}" width="136" height="136">
    <div class="row">
      <img src="${u(f)}" width="56" height="56">
      <img src="${u(s)}" width="32" height="32">
      <img src="${u(s)}" width="24" height="24">
      <img src="${u(s)}" width="18" height="18">
      <img src="${u(s)}" width="16" height="16">
    </div>
    <div class="row dark">
      <img src="${u(f)}" width="48" height="48">
      <img src="${u(s)}" width="24" height="24">
      <img src="${u(s)}" width="18" height="18">
      <img src="${u(s)}" width="16" height="16">
    </div>
  </div>`;
}).join('')}
</div></body></html>`;

fs.writeFileSync(path.join(here, 'bright-study.html'), html);
console.log('wrote bright-study.html');
