// Window-wide state shared by the shell's modules, and a small event bus between them.
export const S = {
  win: '',
  private: false,
  settings: null,
  engines: null,
  bookmarks: { folders: [], items: [] },
  maximized: false,
  fullscreen: false,
  focused: true,
  zen: false,
  htmlFs: false,
  split: null, // { a, b, ratio }: two tabs side by side
  hover: '', // the link under the pointer in the page
};

const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
