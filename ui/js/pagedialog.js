// A page's alert / confirm / prompt and a site's sign-in, as the browser's own dialog over its tab
// (the Gecko build; WebView2 drew its own).
import { invoke, listen, h } from '../shared/api.js';
import { S } from './state.js';
import { T, activate } from './tabs.js';
import { dialog } from './menus.js';
import { t } from '../shared/i18n.js';

// the engine's standard buttons (nsIPromptService.BUTTON_TITLE_*)
const TITLES = { 1: 'OK', 2: 'Hủy', 3: 'Có', 4: 'Không', 5: 'Lưu', 6: 'Không lưu', 7: 'Hoàn nguyên' };

const queue = [];
let busy = false;

async function next() {
  if (busy) return;
  const d = queue.shift();
  if (!d) return;
  busy = true;
  if (T.activeId !== d.tab && T.list.some((x) => x.id === d.tab)) activate(d.tab);
  try {
    invoke('dialog_respond', { id: d.id, reply: await show(d) });
  } finally {
    busy = false;
    next();
  }
}

async function show(d) {
  const site = d.origin ? t('Trang {0} cho biết', d.origin) : t('Trang này cho biết');
  const body = h('div', { class: 'page-dialog' });
  if (d.text) body.append(h('p', { class: 'muted', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '40vh', overflow: 'auto' }, text: d.text }));
  let value = null;
  let user = null;
  let pass = null;
  const field = (type, v, ph) => h('input', { type, value: v || '', placeholder: ph || '', class: 'field', style: { width: '100%', marginTop: '6px' } });
  if (d.type === 'prompt') body.append((value = field('text', d.value)));
  if (d.type === 'promptUserAndPass') body.append((user = field('text', d.user, t('Tên người dùng'))), (pass = field('password', '', t('Mật khẩu'))));
  if (d.type === 'promptPassword') body.append((pass = field('password', '', t('Mật khẩu'))));
  let check = null;
  if (d.checkLabel) {
    check = h('input', { type: 'checkbox', checked: d.checked });
    body.append(h('label', { class: 'opt', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px' } }, check, h('span', { text: d.checkLabel })));
  }
  setTimeout(() => (value || user || pass)?.focus(), 50);

  let buttons;
  if (d.unload) {
    buttons = [
      { label: t('Ở lại'), value: 1 },
      { label: t('Rời trang'), value: 0, primary: true },
    ];
  } else if (d.type === 'confirmEx') {
    buttons = [];
    for (let i = 0; i < 3; i++) {
      const code = (d.flags >> (i * 8)) & 0xff;
      const label = code === 127 ? d.buttons.shift() : TITLES[code];
      if (label) buttons.push({ label: t(label), value: i, primary: i === 0 });
    }
    buttons.reverse();
  } else if (d.type === 'alert' || d.type === 'alertCheck') {
    buttons = [{ label: 'OK', value: 0, primary: true }];
  } else {
    buttons = [
      { label: t('Hủy'), value: 1 },
      { label: 'OK', value: 0, primary: true },
    ];
  }
  const title = d.unload ? t('Rời khỏi trang này?') : d.type === 'promptUserAndPass' || d.type === 'promptPassword' ? d.title || t('Đăng nhập') : site;
  if (d.unload && !d.text) body.append(h('p', { class: 'muted', text: t('Những thay đổi bạn đã thực hiện có thể không được lưu.') }));
  const b = await dialog({ title, body, buttons });
  if (b === null) return null;
  const r = { ok: b === 0, button: b };
  if (value) r.value = value.value;
  if (user) r.user = user.value;
  if (pass) r.pass = pass.value;
  if (check) r.checked = check.checked;
  return r;
}

export function initPageDialogs() {
  listen('page-dialog', (d) => {
    if (d.win !== S.win) return;
    queue.push(d);
    next();
  });
}
