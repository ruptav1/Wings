// The new tab page: clock, greeting, search, shortcuts, over the wallpaper.
import { invoke, esc, toUrl, favicon, hostOf } from '../../shared/api.js';
import { icon } from '../../shared/icons.js';
import { wallpaperStyle } from '../../shared/theme.js';
import { P, initPage, onSettings, setSettings } from '../../shared/page.js';
import { t, LOCALE } from '../../shared/i18n.js';

const $ = (s) => document.querySelector(s);
let engines = {};

function clock() {
  const n = P.settings.newtab;
  const d = new Date();
  const opts = { hour: '2-digit', minute: '2-digit', hour12: !n.clock24h };
  if (n.showSeconds) opts.second = '2-digit';
  $('#clock').textContent = d.toLocaleTimeString(n.clock24h ? 'vi-VN' : 'en-US', opts);
}

function greeting() {
  const n = P.settings.newtab;
  const name = P.settings.general.userName;
  const h = new Date().getHours();
  const by = h < 5 ? 'Khuya rồi, nghỉ ngơi nhé' : h < 11 ? 'Chào buổi sáng' : h < 13 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  $('#greeting').textContent = n.greetingText || (name ? `${t(by)}, ${name}` : t(by));
}

function wallpaper() {
  const w = P.settings.wallpaper;
  const el = $('#wall');
  const st = wallpaperStyle(w, P.settings.appearance);
  el.style.backgroundImage = st.backgroundImage || 'none';
  el.style.backgroundColor = st.backgroundColor || '';
  el.style.backgroundPosition = st.backgroundPosition || 'center';
  el.style.filter = st.filter;
  $('#wall-dim').style.opacity = st.dim || 0;
  const v = $('#wall-video');
  if (w.type === 'video' && w.video) {
    if (v.getAttribute('src') !== w.video) v.src = w.video;
    v.playbackRate = w.videoRate || 1;
    v.hidden = false;
    v.play().catch(() => {});
  } else {
    v.hidden = true;
    v.pause();
    v.removeAttribute('src');
  }
  document.body.classList.toggle('on-picture', w.type === 'image' || w.type === 'video');
  alignWall();
}

// (shown as a page, in split view: its wallpaper is drawn where the window's is, so the two meet)
async function alignWall() {
  const f = await invoke('frame_of').catch(() => null);
  if (!f || !f.w) return;
  Object.assign($('#wall').style, { left: `${-f.x}px`, top: `${-f.y}px`, width: `${f.w}px`, height: `${f.h}px`, right: 'auto', bottom: 'auto' });
}
window.addEventListener('resize', () => alignWall());

function dial() {
  const n = P.settings.newtab;
  const box = $('#dial');
  box.style.setProperty('--cols', Math.min(n.speedDialColumns || 6, (n.speedDial?.length || 0) + 1));
  box.innerHTML =
    (n.speedDial || [])
      .map((d, i) => {
        const letter = esc((hostOf(d.url)[0] || '?').toUpperCase());
        return `<a class="tile" href="${esc(d.url)}" data-i="${i}" title="${esc(d.url)}"><div class="ic"><img src="${esc(favicon(d.url))}" alt="" onerror="this.outerHTML='<span class=&quot;letter&quot;>${letter}</span>'"></div><span>${esc(d.title)}</span><button class="rm" title="Gỡ" data-rm="${i}">${icon('x', 12)}</button></a>`;
      })
      .join('') + `<a class="tile add" href="#" data-add="1"><div class="ic">${icon('plus', 20)}</div><span>Thêm lối tắt</span></a>`;
}

function apply() {
  const n = P.settings.newtab;
  $('#hero').classList.toggle('hidden', !n.showClock && !n.showGreeting);
  $('#clock').classList.toggle('hidden', !n.showClock);
  $('#greeting').classList.toggle('hidden', !n.showGreeting);
  $('#search').classList.toggle('hidden', !n.showSearch);
  $('#dial').classList.toggle('hidden', !n.showSpeedDial);
  const g = P.settings.general;
  $('#q').placeholder = t('Tìm với {0} hoặc nhập địa chỉ', g.searchEngine === 'custom' ? t('công cụ tùy chỉnh') : engines[g.searchEngine]?.name || 'Google');
  clock();
  greeting();
  wallpaper();
  dial();
}

async function main() {
  await initPage();
  engines = await invoke('engines_get');
  $('#engine-ico').innerHTML = icon('search', 18);
  apply();
  onSettings(apply);
  setInterval(clock, 1000);
  setInterval(greeting, 60000);
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = toUrl($('#q').value, P.settings, engines);
    if (url) location.href = url;
  });
  $('#dial').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      e.preventDefault();
      const list = [...P.settings.newtab.speedDial];
      list.splice(+rm.dataset.rm, 1);
      return setSettings({ newtab: { speedDial: list } });
    }
    if (e.target.closest('[data-add]')) {
      e.preventDefault();
      const url = prompt(t('Địa chỉ trang (ví dụ youtube.com):'));
      if (!url) return;
      const full = toUrl(url, P.settings, engines);
      const title = prompt(t('Tên hiển thị:'), hostOf(full)) || hostOf(full);
      setSettings({ newtab: { speedDial: [...P.settings.newtab.speedDial, { title, url: full }] } });
    }
  });
  $('#customize').addEventListener('click', () => invoke('open_tab', { url: 'unk://settings/#newtab' }));
  // (the address bar has the focus on a new tab: typing goes there)
}
main();
