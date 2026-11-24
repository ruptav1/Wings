// A page's context menu, drawn by the interface itself (the Gecko build: the page tells what is under
// the pointer — a link, a picture, a video, selected text, a text field — and the menu is the
// browser's own, in its style and language). The Tauri build used WebView2's menu (extras.rs).
import { invoke, listen, searchUrl } from '../shared/api.js';
import { S } from './state.js';
import { byId, createTab, goBack, active } from './tabs.js';
import { menu, toast } from './menus.js';
import { t } from '../shared/i18n.js';
import { openManga } from './manga.js';

const short = (s, n = 24) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast(t('Đã sao chép'), { iconName: 'check', timeout: 1500 }));
}

async function copyImage(src) {
  try {
    const blob = await (await fetch(src)).blob();
    // (as PNG: what the clipboard takes everywhere)
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast(t('Đã sao chép ảnh'), { iconName: 'check', timeout: 1500 });
  } catch (e) {
    toast(t('Không sao chép được ảnh'));
  }
}

export function initPageMenu() {
  listen('page-menu', (c) => {
    if (c.win !== S.win) return;
    const tab = byId(c.tab);
    if (!tab) return;
    const open = (url, o = {}) => createTab({ url, openerId: tab.id, ...o });
    const ctx = (action, url = '') => invoke('ctx_emit', { tab: tab.id, action, url });
    const page = (cmd) => invoke('page_cmd', { id: tab.id, cmd });
    const http = (u) => /^https?:/i.test(u || '');
    const items = [];
    const sep = () => items.length && items[items.length - 1] !== 'sep' && items.push('sep');

    if (c.link) {
      items.push(
        { label: 'Mở liên kết trong tab mới', icon: 'plus', run: () => open(c.link, { background: true }) },
        http(c.link) && { label: 'Mở liên kết trong cửa sổ mới', icon: 'window', run: () => invoke('win_new', { private: false, url: c.link }) },
        http(c.link) && { label: 'Mở liên kết trong cửa sổ InPrivate', icon: 'incognito', run: () => invoke('win_new', { private: true, url: c.link }) }
      );
      sep();
      items.push({ label: 'Sao chép liên kết', icon: 'link', run: () => copy(c.link) }, http(c.link) && { label: 'Lưu liên kết thành…', icon: 'download', run: () => invoke('download_url', { url: c.link, page: c.page }) });
      sep();
    }
    if (c.media === 'image' && c.src) {
      items.push(
        { label: 'Mở ảnh trong tab mới', icon: 'image', run: () => open(c.src, { background: true }) },
        { label: 'Lưu ảnh thành…', icon: 'save', run: () => invoke('download_url', { url: c.src, page: c.page }) },
        { label: 'Sao chép ảnh', icon: 'copy', run: () => copyImage(c.src) },
        { label: 'Sao chép địa chỉ ảnh', icon: 'link', run: () => copy(c.src) }
      );
      if (http(c.src)) items.push({ label: 'Đặt làm hình nền', icon: 'palette', run: () => ctx('wallpaper', c.src) }, { label: 'Tìm ảnh này với Google Lens', icon: 'search', run: () => ctx('lens', c.src) });
      // (a page of a comic: the whole chapter at once)
      if (http(c.page)) items.push({ label: tab.manga >= 4 ? t('Tải cả chương truyện ({0} ảnh)…', tab.manga) : 'Tải tất cả ảnh truyện trên trang…', icon: 'download', run: () => openManga() });
      sep();
    }
    if ((c.media === 'video' || c.media === 'audio') && c.src) {
      if (http(c.src)) items.push({ label: 'Tải xuống bằng trình tải của trình duyệt', icon: 'download', run: () => ctx('media', c.src) }, { label: 'Mở trong tab mới', icon: 'external', run: () => open(c.src, { background: true }) }, { label: 'Sao chép địa chỉ', icon: 'link', run: () => copy(c.src) });
      if (c.media === 'video') items.push({ label: 'Hình trong hình', icon: 'pip', run: () => ctx('pip') });
      sep();
    }
    if (c.editable) {
      items.push(
        { label: 'Hoàn tác', icon: 'back', keys: 'Ctrl+Z', run: () => page('cmd_undo') },
        'sep',
        { label: 'Cắt', icon: 'edit', keys: 'Ctrl+X', run: () => page('cmd_cut') },
        { label: 'Sao chép', icon: 'copy', keys: 'Ctrl+C', run: () => page('cmd_copy') },
        { label: 'Dán', icon: 'note', keys: 'Ctrl+V', run: () => page('cmd_paste') },
        { label: 'Chọn tất cả', icon: 'check', keys: 'Ctrl+A', run: () => page('cmd_selectAll') }
      );
      sep();
    } else if (c.selection) {
      const q = c.selection.trim().replace(/\s+/g, ' ');
      const eng = S.settings.general.searchEngine === 'custom' ? t('công cụ tìm kiếm') : S.engines[S.settings.general.searchEngine]?.name || 'Google';
      items.push(
        { label: 'Sao chép', icon: 'copy', keys: 'Ctrl+C', run: () => copy(c.selection) },
        { label: t('Tìm "{0}" với {1}', short(q), eng), icon: 'search', run: () => open(searchUrl(q, S.settings, S.engines)) }
      );
      if (/^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(q)) items.push({ label: t('Mở "{0}"', short(q)), icon: 'external', run: () => open(/^https?:/i.test(q) ? q : `https://${q}`) });
      sep();
    }
    if (!c.link && !c.media && !c.selection && !c.editable) {
      items.push(
        { label: 'Quay lại', icon: 'back', keys: 'Alt+Left', disabled: !c.canBack && !tab.ntpBack, run: () => goBack(tab) },
        { label: 'Tiến tới', icon: 'forward', keys: 'Alt+Right', disabled: !c.canForward, run: () => invoke('tab_nav', { id: tab.id, action: 'forward' }) },
        { label: 'Tải lại', icon: 'reload', keys: 'F5', run: () => invoke('tab_nav', { id: tab.id, action: 'reload' }) },
        'sep',
        { label: 'Lưu trang thành…', icon: 'save', keys: 'Ctrl+S', run: () => invoke('tab_nav', { id: tab.id, action: 'saveAs' }) },
        { label: 'In…', icon: 'printer', keys: 'Ctrl+P', run: () => invoke('tab_nav', { id: tab.id, action: 'print' }) },
        http(c.page) && { label: 'Dịch trang này', icon: 'globe', run: () => ctx('translate', c.page) },
        http(c.page) && { label: tab.manga >= 4 ? t('Tải cả chương truyện ({0} ảnh)…', tab.manga) : 'Tải tất cả ảnh truyện trên trang…', icon: 'image', keys: 'Ctrl+Shift+M', run: () => openManga() },
        { label: 'Hình trong hình', icon: 'pip', run: () => ctx('pip') },
        'sep',
        http(c.page) && { label: 'Xem mã nguồn trang', icon: 'code', keys: 'Ctrl+U', run: () => open(`view-source:${c.page}`) }
      );
    }
    while (items[items.length - 1] === 'sep' || items[items.length - 1] === false) items.pop();
    if (!items.filter(Boolean).length) return;
    menu(items.filter(Boolean), { x: c.x, y: c.y });
  });
}

export { active };
