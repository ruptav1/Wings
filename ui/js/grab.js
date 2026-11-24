// Tải từ đường dẫn: a post's videos from its link (YouTube, X, Facebook, TikTok, Instagram, Reddit,
// Bilibili… — what yt-dlp reads: grab.rs; Pixiv's pictures and animations: pixiv.rs). The link is read, each video shown with its picture and the
// qualities it comes in, and the one picked downloaded into Tải xuống.
import { invoke, listen, h, esc, fmtBytes, hostOf } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { $ } from './state.js';
import { active } from './tabs.js';
import { float, toast } from './menus.js';
import { downloadsPopover } from './downloads.js';

const dur = (s) => {
  if (!s) return '';
  s = Math.round(s);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};

function choiceText(c) {
  if (c.kind === 'mp3') return t('Âm thanh MP3');
  // (Pixiv: a picture's original, an animation as GIF)
  if (c.kind === 'image') return [t('Ảnh gốc'), c.label, (c.ext || '').toUpperCase()].filter(Boolean).join(' · ');
  if (c.kind === 'gif') return ['GIF', c.width && c.height ? `${c.width}×${c.height}` : ''].filter(Boolean).join(' · ');
  if (c.kind === 'audio') return `${t('Âm thanh')} ${c.label}${c.abr ? ` · ${Math.round(c.abr)} kbps` : ''}`;
  return [c.label, c.fps > 30 ? `${Math.round(c.fps)}fps` : '', (c.ext || 'mp4').toUpperCase(), c.vcodec && c.vcodec !== 'avc1' ? c.vcodec.toUpperCase() : ''].filter(Boolean).join(' · ');
}

let closeIt = null;

/** Opens the panel, with `url` in its box (the tab's own page by default) read at once. */
export function openGrab(url) {
  closeIt?.();
  const tab = active();
  const start = url || (tab && /^https?:/.test(tab.url) ? tab.url : '');
  const input = h('input', { type: 'text', spellcheck: 'false', placeholder: 'https://www.youtube.com/watch?v=…' });
  input.value = start;
  const go = h('button', { class: 'btn primary', html: `${icon('search', 15)}<span>${esc(t('Đọc'))}</span>` });
  const status = h('div', { class: 'grab-status' });
  const result = h('div', { class: 'grab-result' });
  const el = h(
    'div',
    { class: 'popover grab' },
    h('div', { class: 'grab-head' }, h('span', { class: 'grab-ic', html: icon('download', 20) }), h('b', { text: t('Tải từ đường dẫn') }), h('span', { class: 'grow' }), h('button', { class: 'icon-btn', title: t('Đóng'), html: icon('x', 16), onclick: () => closeIt?.() })),
    h('div', { class: 'grab-row' }, input, go),
    status,
    result,
    h('small', { class: 'grab-note', text: t('Dùng yt-dlp: YouTube, X, Facebook, TikTok, Instagram, Reddit, Bilibili và hàng nghìn trang khác; Pixiv bằng tài khoản Pixiv của bạn trong trình duyệt. Chỉ tải nội dung bạn được phép tải.') })
  );
  let reading = 0;
  const read = async () => {
    const link = input.value.trim();
    if (!link) return input.focus();
    const seq = ++reading;
    go.disabled = true;
    result.replaceChildren();
    const tools = await invoke('grab_tools');
    status.className = 'grab-status busy';
    status.textContent = tools.ytdlp ? t('Đang đọc {0}…', hostOf(link) || link) : t('Lần đầu dùng: đang tải yt-dlp (khoảng 22 MB)…');
    try {
      const info = await invoke('grab_info', { url: link });
      if (seq !== reading) return;
      status.className = 'grab-status';
      status.textContent = '';
      show(info);
    } catch (e) {
      if (seq !== reading) return;
      status.className = 'grab-status bad';
      status.textContent = String(e);
    } finally {
      go.disabled = false;
    }
  };
  const show = (info) => {
    const many = info.entries.length > 1;
    if (many) result.append(h('div', { class: 'grab-title' }, h('b', { text: info.title || '' }), h('small', { text: [info.uploader, info.site, t('{0} video', info.entries.length)].filter(Boolean).join(' · ') })));
    for (const e of info.entries) {
      const card = h('div', { class: 'grab-card' });
      const thumb = h('div', { class: 'grab-thumb' }, e.thumb ? h('img', { src: e.thumb, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { html: icon('video', 28) }), e.duration ? h('span', { class: 'grab-dur', text: dur(e.duration) }) : null);
      const list = h('div', { class: 'grab-choices' });
      for (const c of e.choices) {
        const b = h('button', { class: 'btn small', html: `${icon('download', 14)}<span>${esc(t('Tải'))}</span>` });
        b.addEventListener('click', async () => {
          b.disabled = true;
          const title = `${e.title || info.title || 'video'}`;
          await invoke('grab_download', { url: info.url, key: c.key, kind: c.kind, index: e.index || null, title });
          b.innerHTML = `${icon('check', 14)}<span>${esc(t('Đang tải'))}</span>`;
          toast(t('Đang tải {0}', title), { iconName: 'download', action: { label: t('Xem'), run: () => downloadsPopover($('[data-item="downloads"]') || $('#omnibox')) } });
        });
        list.append(h('div', { class: `grab-choice ${c.kind}` }, h('span', { class: 'grab-q', html: `${icon(c.kind === 'video' ? 'video' : c.kind === 'image' || c.kind === 'gif' ? 'image' : 'music', 15)}<span>${esc(choiceText(c))}</span>` }), h('span', { class: 'grab-size', text: c.size > 0 ? `~${fmtBytes(c.size)}` : '' }), b));
      }
      if (!info.ffmpeg && e.choices.some((c) => c.kind !== 'audio')) list.append(h('small', { class: 'muted', text: t('Video tách tiếng và MP3 cần FFmpeg: lần tải đầu sẽ tải FFmpeg (khoảng 28 MB).') }));
      card.append(thumb, h('div', { class: 'grab-info' }, h('b', { class: 'grab-name', text: e.title || info.title || '' }), many ? null : h('small', { text: [info.uploader, info.site].filter(Boolean).join(' · ') }), list));
      result.append(card);
    }
  };
  go.addEventListener('click', read);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && read());
  closeIt = float(el, { x: innerWidth / 2 - 290, y: 70 }, { modal: true, keepOnBlur: true, onClose: () => (closeIt = null) });
  invoke('shell_focus');
  setTimeout(() => (input.focus(), input.select()), 30);
  if (start) read();
}

export function initGrab() {
  // (the programs' first download: how far it got)
  listen('grab-tool', ({ name, done }) => {
    const s = document.querySelector('.grab-status.busy');
    if (s && done < 1) s.textContent = t('Lần đầu dùng: đang tải {0}… {1}%', name, Math.round(done * 100));
  });
}
