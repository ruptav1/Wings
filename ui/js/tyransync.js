// TyranWeb 1.8.0 or newer on this machine: a moment after the start, the browser asks once whether to
// sync data from TyranWeb: its data files (settings, history, bookmarks, downloads, tabs) copied in at
// a restart, its wallpaper folder (pictures, videos) shared and used where it is. Whatever the answer,
// it is not asked again; Settings → Giới thiệu has the button for later (tyransync.rs).
import { invoke, h } from '../shared/api.js';
import { S } from './state.js';
import { dialog, toast } from './menus.js';
import { t } from '../shared/i18n.js';

/** 1.8.0.0 -> 1.8.0 */
export const shortVersion = (v) => String(v || '').replace(/^(\d+\.\d+\.\d+)\.0$/, '$1');

export async function askTyranSync() {
  if (S.private) return;
  let st;
  try {
    st = await invoke('tyran_sync_status', { claim: true });
  } catch {
    return;
  }
  if (!st?.ask) return;
  const body = h(
    'div',
    { class: 'tyran-ask' },
    h('p', { text: t('Đã tìm thấy TyranWeb {0} trên máy. Bạn có muốn đồng bộ data từ TyranWeb không?', shortVersion(st.version)) }),
    h('p', { class: 'muted', text: t('Cài đặt, lịch sử, dấu trang, tải xuống và các tab của TyranWeb sẽ được chép sang, thay cho dữ liệu hiện tại của Wings. Riêng ảnh nền và video nền dùng chung thư mục với TyranWeb. Trình duyệt sẽ khởi động lại.') }),
    h('p', { class: 'muted small', text: t('Câu hỏi này chỉ hiện một lần. Sau này vẫn đồng bộ được trong Cài đặt → Giới thiệu.') })
  );
  const yes = await dialog({
    title: t('Đồng bộ data từ TyranWeb?'),
    body,
    width: 440,
    sticky: true,
    buttons: [
      { label: t('Không'), value: false, focus: true },
      { label: t('Có, đồng bộ'), value: true, danger: true },
    ],
  });
  // (closed without an answer, as by Esc: asked again at the next start)
  if (yes === null) return;
  await invoke('tyran_sync_answer', { yes }).catch(() => {});
  if (!yes) return toast(t('Có thể đồng bộ data từ TyranWeb sau trong Cài đặt → Giới thiệu'), { timeout: 4500 });
  try {
    await invoke('tyran_sync_start');
    toast(t('Đang đồng bộ data từ TyranWeb, trình duyệt sẽ khởi động lại…'), { timeout: 3000 });
    setTimeout(() => invoke('app_restart'), 900);
  } catch (e) {
    toast(t('Không đồng bộ được: {0}', String(e)), { timeout: 6000 });
  }
}

export function initTyranSync() {
  // (once the windows and their tabs are back: the question does not land on a half-drawn window)
  setTimeout(askTyranSync, 2500);
}
