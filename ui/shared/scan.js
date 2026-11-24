// Kiểm tra tệp tải về (from TyranWeb): a download's scan, as a small mark on its row (the downloads
// popover, the sidebar, the downloads page); a press on it opens its result page (unk://scan).
import { esc } from './api.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

const VT_BAD = 3;
const BUSY = ['queued', 'looking', 'uploading', 'analyzing'];

/** How bad it is: 'bad' | 'warn' | 'ok' | 'busy' | 'na' | '' (not scanned) */
export function scanLevel(scan) {
  if (!scan) return '';
  const st = scan.vt?.stats || {};
  if (['threat', 'removed'].includes(scan.state) || (st.malicious || 0) >= VT_BAD) return 'bad';
  if ((st.malicious || 0) > 0 || (st.suspicious || 0) > 0) return 'warn';
  if (['queued', 'scanning'].includes(scan.state) || BUSY.includes(scan.vt?.state)) return 'busy';
  if (scan.state === 'clean' || scan.vt?.state === 'done') return 'ok';
  return 'na';
}

export function scanWords(scan) {
  const lv = scanLevel(scan);
  if (!lv) return '';
  if (scan.state === 'removed') return t('Đã bị chặn: {0}', scan.threat || '?');
  if (scan.state === 'threat') return t('Có mã độc: {0}', scan.threat || '?');
  const n = scan.vt?.stats?.malicious || 0;
  if (lv === 'bad') return t('{0} hãng bảo mật báo độc hại', n);
  if (lv === 'warn') return t('Đáng ngờ');
  if (lv === 'busy') return t('Đang kiểm tra…');
  if (lv === 'ok') return t('An toàn');
  return t('Không kiểm tra được');
}

/** The mark (HTML) for a download's row; `id` is its record's id. */
export function scanBadge(d) {
  const lv = scanLevel(d.scan);
  if (!lv) return '';
  const ic = { bad: 'warn', warn: 'warn', ok: 'shieldCheck', busy: 'shield', na: 'shield' }[lv];
  const id = String(d.id).replace(/-old$/, '');
  return `<button class="scan-badge lv-${lv}" data-scan="${esc(id)}" title="${esc(t('Kết quả kiểm tra'))}">${icon(ic, 12)}<span>${esc(scanWords(d.scan))}</span></button>`;
}

export const scanUrl = (id) => `unk://scan/?id=${encodeURIComponent(String(id).replace(/-old$/, ''))}`;
