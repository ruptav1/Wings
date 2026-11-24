// Tải truyện tranh: the comic chapter shown in the tab - its pictures found in the page (in reading order,
// lazy ones too, without ads), its series and chapter names - downloaded at once into
// one ZIP with <series>/<chapter>/ inside (or a CBZ or folder per chapter), and on request the chapters
// after it (the tab goes on to each).
// The page side: gecko actors/MangaScan.sys.mjs; the downloads: Manga.sys.mjs.
import { invoke, h, esc } from '../shared/api.js';
import { icon } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { S, $ } from './state.js';
import { active } from './tabs.js';
import { float, toast } from './menus.js';
import { downloadsPopover } from './downloads.js';

let closeIt = null;

/** Opens the panel for the active tab's page and reads its chapter at once. */
export async function openManga() {
  closeIt?.();
  const tab = active();
  if (!tab || !/^https?:/.test(tab.url)) return toast(t('Mở trang đọc một chương truyện trước đã'), { iconName: 'image' });
  const status = h('div', { class: 'grab-status busy', text: t('Đang tìm ảnh truyện trên trang…') });
  const body = h('div', { class: 'manga-body' });
  const el = h(
    'div',
    { class: 'popover grab manga' },
    h('div', { class: 'grab-head' }, h('span', { class: 'grab-ic', html: icon('image', 20) }), h('div', { class: 'manga-ttl' }, h('b', { text: t('Tải truyện tranh') }), h('small', { text: new URL(tab.url).hostname })), h('span', { class: 'grow' }), h('button', { class: 'icon-btn', title: t('Đóng'), html: icon('x', 16), onclick: () => closeIt?.() })),
    status,
    body,
    h('small', { class: 'grab-note', text: t('Tải bằng phiên đăng nhập của bạn trên trang này. Chỉ tải nội dung bạn được phép tải.') })
  );
  closeIt = float(el, { x: innerWidth / 2 - 320, y: 64 }, { modal: true, keepOnBlur: true, onClose: () => (closeIt = null) });

  let scan = null;
  const read = async (scroll) => {
    status.className = 'grab-status busy';
    status.textContent = scroll ? t('Đang cuộn trang để nạp hết ảnh…') : t('Đang tìm ảnh truyện trên trang…');
    body.replaceChildren();
    try {
      scan = await invoke('manga_scan', { tab: tab.id, scroll });
    } catch (e) {
      status.className = 'grab-status bad';
      status.textContent = t('Không đọc được trang: {0}', String(e?.message || e));
      return;
    }
    draw();
  };

  const draw = () => {
    const n = scan.paged ? scan.pageUrls.length : scan.items.length;
    if (!n) {
      status.className = 'grab-status bad';
      status.textContent = t('Không thấy ảnh truyện nào trên trang này.');
      body.append(h('div', { class: 'manga-actions' }, h('button', { class: 'btn', html: `${icon('reload', 15)}<span>${esc(t('Cuộn trang và tìm lại'))}</span>`, onclick: () => read(true) })));
      return;
    }
    status.className = 'grab-status';
    status.textContent = scan.paged ? t('Truyện đọc từng trang: {0} trang', n) : t('Tìm thấy {0} ảnh', n);
    const off = new Set(); // pictures left out by the user
    const series = h('input', { type: 'text', value: scan.series, spellcheck: 'false' });
    const chapter = h('input', { type: 'text', value: scan.chapter, spellcheck: 'false' });
    const count = h('span', { class: 'manga-count' });
    const go = h('button', { class: 'btn primary' });
    const refresh = () => {
      const k = scan.paged ? n : n - off.size;
      count.textContent = scan.paged ? '' : t('Đã chọn {0}/{1}', k, n);
      go.innerHTML = `${icon('download', 15)}<span>${esc(t('Tải {0} ảnh', k))}</span>`;
      go.disabled = !k;
    };
    const grid = h('div', { class: 'manga-grid' });
    if (!scan.paged) {
      scan.items.forEach((it, i) => {
        const cell = h('button', { class: 'manga-cell', title: t('Bấm để bỏ / chọn lại ảnh {0}', i + 1) }, h('img', { src: it.thumb || it.url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }), h('span', { text: String(i + 1) }));
        cell.addEventListener('click', () => {
          off.has(i) ? off.delete(i) : off.add(i);
          cell.classList.toggle('off', off.has(i));
          refresh();
        });
        grid.append(cell);
      });
    }
    // (pages the page has not loaded yet: their previews come a moment later, loaded by the page itself)
    const missing = scan.paged ? [] : scan.items.filter((it) => !it.thumb).map((it) => it.url);
    if (missing.length)
      invoke('manga_thumbs', { tab: tab.id, urls: missing })
        .then((list) => {
          const at = new Map(list.map((x) => [x.url, x.thumb]));
          scan.items.forEach((it, i) => {
            const thumb = at.get(it.url);
            const cell = grid.children[i];
            if (!thumb || !cell) return;
            it.thumb = thumb;
            cell.querySelector('img')?.remove();
            cell.prepend(h('img', { src: thumb, alt: '' }));
          });
        })
        .catch(() => {});
    const all = h('button', { class: 'btn small', text: t('Chọn tất cả'), onclick: () => (off.clear(), grid.querySelectorAll('.off').forEach((c) => c.classList.remove('off')), refresh()) });
    const nextN = h('input', { type: 'number', min: '0', max: '200', value: '0', disabled: !scan.next });
    const scroll = h('input', { type: 'checkbox' });
    // A ZIP groups the selected chapters. The other formats are per chapter.
    const format = h(
      'select',
      { class: 'manga-format' },
      ...[
        ['zip', t('File zip')],
        ['cbz', t('File CBZ (cho app đọc truyện)')],
        ['folder', t('Thư mục ảnh')],
      ].map(([v, l]) => h('option', { value: v, text: l }))
    );
    format.value = ['zip', 'cbz', 'folder'].includes(S.settings?.general?.mangaFormat) ? S.settings.general.mangaFormat : 'zip';
    const ext = () => (format.value === 'folder' ? '' : `.${format.value}`);
    let nextShown = '';
    try {
      nextShown = scan.next ? decodeURIComponent(new URL(scan.next).pathname) : '';
    } catch {
      nextShown = scan.next;
    }
    body.append(
      h('div', { class: 'manga-names' }, h('label', {}, h('span', { text: t('Tên truyện') }), series), h('label', {}, h('span', { text: t('Chương') }), chapter)),
      scan.paged ? h('div', { class: 'manga-paged', text: t('Mỗi trang của chương nằm ở một địa chỉ riêng: Wings sẽ mở lần lượt từng trang để lấy ảnh.') }) : h('div', { class: 'manga-bar' }, count, h('span', { class: 'grow' }), all),
      grid,
      h(
        'div',
        { class: 'manga-opts' },
        h('label', { class: 'manga-next' }, h('span', { text: t('Tải tiếp') }), nextN, h('span', { text: t('chương sau') }), h('small', { title: scan.next || '', text: scan.next ? `→ ${nextShown}` : t('(không thấy link chương sau)') })),
        h('label', { class: 'manga-check' }, scroll, h('span', { text: t('Luôn cuộn hết mỗi chương (trang nạp ảnh bằng JavaScript)') })),
        h('label', { class: 'manga-fmt' }, h('span', { text: t('Định dạng lưu') }), format)
      ),
      h('div', { class: 'manga-dest' }),
      h('div', { class: 'manga-actions' }, h('button', { class: 'btn', html: `${icon('reload', 15)}<span>${esc(t('Tìm lại'))}</span>`, title: t('Cuộn hết trang rồi tìm lại ảnh'), onclick: () => read(true) }), h('span', { class: 'grow' }), go)
    );
    const dest = body.querySelector('.manga-dest');
    const syncDest = () => {
      const title = series.value.trim() || '…';
      const chap = chapter.value.trim() || '…';
      const grouped = format.value === 'zip' && Number(nextN.value) >= 1;
      const filename = (grouped ? title : `${title} - ${chap}`) + ext();
      const path = format.value === 'zip' ? `${filename} › ${title} › ${chap} › 001.png` : filename;
      dest.textContent = t('Lưu vào: Tải xuống › {0}', path);
      dest.title = dest.textContent;
    };
    series.addEventListener('input', syncDest);
    chapter.addEventListener('input', syncDest);
    nextN.addEventListener('input', syncDest);
    // (the choice is kept for next time)
    format.addEventListener('change', () => {
      syncDest();
      invoke('settings_set', { patch: { general: { mangaFormat: format.value } } }).catch(() => {});
    });
    syncDest();
    refresh();
    go.addEventListener('click', async () => {
      // (the pictures' addresses only: the small previews stay here)
      const items = scan.paged ? [] : scan.items.filter((_, i) => !off.has(i)).map(({ url, alts, w, h }) => ({ url, alts, w, h }));
      const more = Math.max(0, Math.min(200, Number(nextN.value) || 0));
      go.disabled = true;
      try {
        await invoke('manga_download', { tab: tab.id, series: series.value.trim(), chapter: chapter.value.trim(), items, page: scan.url, next: more, scroll: scroll.checked, format: format.value, selector: scan.selector, nextUrl: scan.next, paged: !!scan.paged, pageUrls: scan.pageUrls || [] });
      } catch (e) {
        go.disabled = false;
        status.className = 'grab-status bad';
        status.textContent = String(e?.message || e);
        return;
      }
      closeIt?.();
      const what = scan.paged ? t('{0} trang', n) : t('{0} ảnh', items.length);
      toast(more ? t('Đang tải {0} ({1}) và {2} chương sau', what, chapter.value, more) : t('Đang tải {0}: {1}', what, `${series.value} — ${chapter.value}`), {
        iconName: 'download',
        action: { label: t('Xem'), run: () => downloadsPopover($('[data-item="downloads"]') || $('#omnibox')) },
      });
    });
  };
  read(false);
}
