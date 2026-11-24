// Shared by the unk:// pages: the settings, the theme, and staying in step when they change.
import { invoke, listen } from './api.js';
import { applyTheme } from './theme.js';
import { hydrateIcons } from './icons.js';
import { watch } from './i18n.js';
import { initCursor } from './cursor.js';

export const P = { settings: null };
const subs = [];

export async function initPage() {
  P.settings = await invoke('settings_get');
  applyTheme(P.settings);
  hydrateIcons(document);
  watch();
  listen('settings', (s) => {
    P.settings = s;
    applyTheme(s);
    subs.forEach((f) => f(s));
  });
  initCursor();
  document.body.classList.add('ready');
  return P.settings;
}

export const onSettings = (f) => subs.push(f);
export const setSettings = (patch) => invoke('settings_set', { patch });
/** Opens a URL in a new tab of this window. */
export const openTab = (url, background = false) => invoke('open_tab', { url, background });
