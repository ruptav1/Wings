import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const B = path.resolve(here, '..');
const u = (p) => 'data:image/svg+xml;utf8,' + encodeURIComponent(fs.readFileSync(path.join(B, p), 'utf8'));

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;padding:36px;font-family:"Segoe UI",system-ui,sans-serif;background:#f7f5f3;color:#1b1b22}
h1{margin:0 0 6px;font-size:26px;letter-spacing:-.02em}
p.sub{margin:0 0 26px;color:#666;font-size:14px}
.top{display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr;gap:20px;margin-bottom:22px}
.card{background:#fff;border:1px solid #e6e3df;border-radius:18px;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
.card.dark{background:#232534;border-color:#232534;color:#fff}
.card .cap{font-size:12px;font-weight:600;color:#666}
.card.dark .cap{color:#b6bac9}
.bottom{display:grid;grid-template-columns:1.3fr 1fr;gap:20px}
.panel{background:#fff;border:1px solid #e6e3df;border-radius:18px;padding:22px 26px}
.panel h2{margin:0 0 14px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#777}
.sizes{display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:14px}
.sz{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:#777}
.bar{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:10px;background:#232534;color:#eef2f8;font-size:13px;font-weight:500}
.bar.light{background:#f1eff3;color:#232534;margin-top:8px}
.swatches{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.sw{display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid #ece9e5;border-radius:10px;font-size:12px}
.dot{width:30px;height:30px;border-radius:8px;flex:none;border:1px solid rgba(0,0,0,.08)}
.sw b{display:block;font-size:12px} .sw span{color:#777;font-size:11px;font-family:Consolas,monospace}
</style></head><body>
<h1>Wings (Gecko) — Sōyoku Kamon (双羽紋)</h1>
<p class="sub">Bộ nhận diện chính thức · Phối màu từ hình nền mặc định wings-default.jpg · Đã áp vào UI, wings.ico (10 cỡ) &amp; Wings.exe</p>
<div class="top">
  <div class="card"><img src="${u('wings.svg')}" width="164" height="164"><div class="cap">Icon App (wings.svg)</div></div>
  <div class="card"><img src="${u('kit/wings-symbol.svg')}" width="136" height="136"><div class="cap">Biểu tượng chính (màu phẳng)</div></div>
  <div class="card dark"><img src="${u('kit/wings-symbol-reversed.svg')}" width="136" height="136"><div class="cap">Nền tối (làm mảnh ~3%)</div></div>
  <div class="card"><img src="${u('kit/wings-symbol-black.svg')}" width="136" height="136"><div class="cap">Một màu đen (in ấn)</div></div>
</div>
<div class="bottom">
  <div class="panel">
    <h2>Hiển thị thực tế theo kích cỡ (bản đầy đủ &amp; bản 16–32 px)</h2>
    <div class="sizes">
      <div class="sz"><img src="${u('wings.svg')}" width="56" height="56">56 px · Giới thiệu</div>
      <div class="sz"><img src="${u('wings-small.svg')}" width="32" height="32">32 px · Taskbar</div>
      <div class="sz"><img src="${u('wings-small.svg')}" width="24" height="24">24 px · Cài đặt</div>
      <div class="sz"><img src="${u('wings-small.svg')}" width="18" height="18">18 px · Tiêu đề</div>
      <div class="sz"><img src="${u('wings-small.svg')}" width="16" height="16">16 px · Favicon</div>
    </div>
    <div class="bar"><img src="${u('wings-small.svg')}" width="18" height="18"><span>Wings — Thanh tiêu đề nền tối (18 px)</span></div>
    <div class="bar light"><img src="${u('wings-small.svg')}" width="18" height="18"><span>Wings — Thanh tiêu đề nền sáng (18 px)</span></div>
  </div>
  <div class="panel">
    <h2>Bảng màu (từ wings-default.jpg)</h2>
    <div class="swatches">
      <div class="sw"><div class="dot" style="background:#A41154"></div><div><b>Sakura Crimson</b><span>#A41154</span></div></div>
      <div class="sw"><div class="dot" style="background:#D4528A"></div><div><b>Warm Rose</b><span>#D4528A</span></div></div>
      <div class="sw"><div class="dot" style="background:#E4F1FD"></div><div><b>Ice Pearl</b><span>#E4F1FD</span></div></div>
      <div class="sw"><div class="dot" style="background:linear-gradient(45deg,#D43B7E,#EE75AA,#FBBAD5)"></div><div><b>Icon Tile</b><span>#D43B7E → #FBBAD5</span></div></div>
    </div>
  </div>
</div>
</body></html>`;

fs.writeFileSync(path.join(here, 'final-showcase.html'), html);
console.log('wrote final-showcase.html');
