// "Tải truyện tranh" - the page side (in the page's own process, for UnkPageChild): finds a comic chapter's
// page pictures in the page as it is - lazily loaded ones by their real addresses - in reading order, without
// the site's ads, logos and thumbnails; reads the series' and the chapter's names and the link to the next
// chapter. Known reader frames first (WordPress Madara and MangaStream, as named in Haruneko's site templates,
// github.com/manga-download/haruneko, Unlicense; and the common Vietnamese and English reader sites), else the
// frame holding the most large pictures. Works on a fetched page too (no layout: only the frame and the
// pictures' own attributes), for readers that show one picture per address.

// the reader frames of well-known reader sites and site engines (a chapter's pictures are inside)
export const READERS = [
  // WordPress Madara, MangaStream (Haruneko's templates)
  ".reading-content",
  "div.page-break",
  "#readarea",
  "#readerarea",
  ".reader-area",
  // NetTruyen / NhatTruyen and their kind, TruyenQQ, BlogTruyen, CuuTruyen-like readers
  ".reading-detail",
  ".page-chapter",
  ".chapter_content",
  "#chapter_content",
  ".chapter-content",
  "#chapter-content",
  ".content-chapter",
  ".chapter-c",
  ".box_doc",
  "#chapter_boxImages",
  // more long vertical readers (the pages one under another, scrolled through)
  ".list-image-detail",
  ".chapter-content-images",
  ".content-image",
  ".chapter_img",
  ".page_chapter",
  ".reading-box",
  "#chapter-reader",
  ".chapter-detail",
  // Manganato / Mangakakalot, Webtoons, MangaPark-like, others
  ".container-chapter-reader",
  "#vungdoc",
  ".vung-doc",
  "#_imageList",
  ".viewer_lst",
  ".chapter-images",
  ".chapter-img",
  ".images-chapter",
  ".comic-reader",
  ".manga-reader",
  ".read-content",
  "#chapter-images",
  ".reader",
  "#reader",
  ".viewer",
  "#viewer",
];

// where the real address of a picture loaded lazily waits
const LAZY = ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-url", "data-echo", "data-cfsrc", "data-original-src", "data-aload", "data-img", "data-image", "data-full", "data-srcset", "data-lazy-srcset"];
// stand-in pictures shown until then
const PLACEHOLDER = /^data:image\/(?:gif|svg\+xml)|(?:^|[/_.-])(?:loading|lazy|placeholder|blank|spacer|pixel|1x1|transparent)[^/]*\.(?:gif|png|svg|jpe?g|webp)(?:$|[?#])/i;
const AD_URL = /doubleclick|googlesyndication|adservice|adsystem|\/ads?\/|\/banners?\/|popads|adsterra|exoclick|juicyads|propellerads|histats/i;
// boxes that hold ads, in or out of the reader
const AD_BOX = '[class*="advert" i], [id*="advert" i], [class~="ads"], [id~="ads"], [class*="ads-" i], [class*="-ads" i], [class*="ads_" i], [class*="_ads" i], [id*="ads-" i], [class*="banner" i], [class*="quangcao" i], [class*="qc-" i]';
// parts of a page that are not the reader
const NOT_READER =
  'header, nav, footer, aside, [role="banner"], [role="navigation"], [role="contentinfo"], [class*="comment" i], [id*="comment" i], [class*="sidebar" i], [id*="sidebar" i], [class*="widget" i], [class*="related" i], [class*="recommend" i], [class*="advert" i], [id*="advert" i], [class*="banner" i], [class~="ads"], [class*="ads-" i], [class*="-ads" i], [id~="ads"], [class*="logo" i], [class*="avatar" i]';
// "Chapter 12", "Chương 12", "Chap 12.5", "Ep. 3", "Tập 4", "#12", "第12話"…
const CHAP = /(?:chap(?:ter)?|chương|chuong|ch\.|episode|ep\.?|tập|tap|#)\s*[-:.]?\s*(\d+(?:[.,]\d+)?)|第\s*(\d+(?:\.\d+)?)\s*[話话章]/i;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
function abs(u, base) {
  try {
    return new URL(String(u).trim(), base).href;
  } catch {
    return "";
  }
}
function srcsetBest(s) {
  let best = "";
  let most = -1;
  for (const part of String(s).split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    const v = parseFloat(d) || 1;
    if (u && v > most) (best = u), (most = v);
  }
  return best;
}
const hasLazy = (img) => LAZY.some((a) => img.hasAttribute(a));

/** The picture's own address: where a lazy loader keeps it, its largest srcset entry, or what it shows. */
export function realSrc(img, base) {
  for (const a of LAZY) {
    const v = img.getAttribute(a);
    if (!v || !v.trim()) continue;
    const u = a.endsWith("srcset") ? srcsetBest(v) : v;
    if (u && !PLACEHOLDER.test(u)) return abs(u, base);
  }
  const set = img.getAttribute("srcset");
  if (set) {
    const u = srcsetBest(set);
    if (u && !PLACEHOLDER.test(u)) return abs(u, base);
  }
  const s = img.currentSrc || img.getAttribute("src") || "";
  return s && !PLACEHOLDER.test(s) ? abs(s, base) : "";
}

/** Whether the picture it shows is its own (not a stand-in still waiting for the real one). */
function loadedReal(img, base) {
  if (!img.complete || !(img.naturalWidth > 0)) return false;
  const showing = img.currentSrc || img.src || "";
  return !PLACEHOLDER.test(showing) && showing === realSrc(img, base);
}

/**
 * What size of picture it is: 'page' (a page of a comic: at least 120 px tall, at most four times as wide as
 * tall), 'slice' (a thin strip of one - long vertical readers, webtoons, cut their pages into strips - kept
 * only beside pages or strips of the same width, which an ad banner is not), or false. Loaded, its own size
 * decides (a page's CSS may stretch a banner to the reader's width); not loaded yet, its place on the page.
 * A fetched page (no layout): only what says it is small is left out.
 */
function sizeKind(img, live, base) {
  if (!live) {
    const w = +img.getAttribute("width") || 0;
    const h = +img.getAttribute("height") || 0;
    return !(w && w < 150) && !(h && h < 40) ? "page" : false;
  }
  if (loadedReal(img, base)) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < 300) return false;
    if (h >= 120 && w / h <= 4) return "page";
    return h >= 40 ? "slice" : false;
  }
  const r = img.getBoundingClientRect();
  return r.width >= 250 || (r.width === 0 && hasLazy(img)) ? "page" : false;
}

// where a site keeps other servers' copies of the picture (switched to when the first fails)
const SERVERS = ["data-cdn", "data-sv1", "data-sv2", "data-sv3", "data-server", "data-server1", "data-server2", "data-backup", "data-src2", "data-alt", "data-fallback", "data-original", "data-src", "src"];
/** The picture's other addresses (other servers, the other lazy attributes), after its own. */
function altsOf(img, base, url) {
  const out = [];
  for (const a of SERVERS) {
    const v = img.getAttribute(a);
    if (!v || PLACEHOLDER.test(v)) continue;
    const u = abs(v, base);
    if (u && u !== url && /^https?:/i.test(u) && !out.includes(u)) out.push(u);
  }
  return out.slice(0, 4);
}

function pick(imgs, base, live) {
  const seen = new Set();
  const out = [];
  for (const img of imgs) {
    const url = realSrc(img, base);
    if (!url || seen.has(url) || AD_URL.test(url) || !/^(?:https?|data|blob):/i.test(url)) continue;
    const kind = sizeKind(img, live, base);
    if (!kind) continue;
    seen.add(url);
    const alts = altsOf(img, base, url);
    out.push({ url, ...(alts.length ? { alts } : {}), kind, w: (live && img.naturalWidth) || +img.getAttribute("width") || 0, h: (live && img.naturalHeight) || +img.getAttribute("height") || 0, el: img });
  }
  // strips: kept when they are as wide as the reader's pages (or, a reader all of strips, as each other)
  const slices = out.filter((x) => x.kind === "slice");
  if (slices.length) {
    const pages = out.filter((x) => x.kind === "page" && x.w);
    const ref = (pages.length ? pages : slices).map((x) => x.w).sort((a, b) => a - b);
    const mid = ref[Math.floor(ref.length / 2)] || 0;
    const sameWidth = (x) => mid && Math.abs(x.w - mid) <= mid * 0.03;
    const keep = pages.length ? sameWidth : (x) => sameWidth(x) && slices.filter(sameWidth).length >= 5;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === "slice" && !keep(out[i])) out.splice(i, 1);
  }
  // (in one reader the pages are about as wide on screen as each other: a far narrower picture is not one)
  if (live && out.length >= 3) {
    const widths = out.map((x) => x.el.getBoundingClientRect().width).filter(Boolean).sort((a, b) => a - b);
    const mid = widths[Math.floor(widths.length / 2)] || 0;
    if (mid) return out.filter((x) => {
      const w = x.el.getBoundingClientRect().width;
      return !w || w >= mid * 0.55;
    });
  }
  return out;
}

function byKnownFrame(doc, base, live, hint, min) {
  let best = null;
  for (const sel of hint ? [hint, ...READERS] : READERS) {
    let frames;
    try {
      frames = doc.querySelectorAll(sel);
    } catch {
      continue;
    }
    if (!frames.length) continue;
    const imgs = [...frames].flatMap((f) => [...f.querySelectorAll("img")]).filter((img) => !img.closest(AD_BOX));
    const items = pick(imgs, base, live);
    if (items.length >= min && (!best || items.length > best.items.length)) best = { sel, items };
    // (the frame the chapter before was found in: the same site, so the same reader)
    if (sel === hint && best?.sel === hint) return best;
  }
  return best;
}

function escapeCss(doc, s) {
  const css = doc.defaultView?.CSS;
  return css?.escape ? css.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
/** A selector that finds the frame again (in this page, and in the next chapter's). */
function selectorOf(doc, el) {
  const parts = [];
  for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
    if (e.id && !/\d{3,}/.test(e.id)) {
      parts.unshift(`#${escapeCss(doc, e.id)}`);
      break;
    }
    const cls = [...e.classList].filter((c) => !/\d{3,}|active|show|open|loaded|lazy/i.test(c)).slice(0, 2);
    parts.unshift(e.localName + cls.map((c) => `.${escapeCss(doc, c)}`).join(""));
    if (e.localName === "body") break;
  }
  return parts.join(" > ");
}

/** No known frame: the element holding the most large pictures (the deepest of equals). */
function byLargestFrame(doc, base, min) {
  const imgs = [...doc.images].slice(0, 2000).filter((img) => !img.closest(NOT_READER) && !img.closest(AD_BOX));
  const good = pick(imgs, base, true);
  if (good.length < min) return null;
  const count = new Map();
  for (const it of good) {
    let a = it.el.parentElement;
    for (let d = 0; a && a !== doc.documentElement && d < 8; d++, a = a.parentElement) count.set(a, (count.get(a) || 0) + 1);
  }
  let frame = null;
  let n = 0;
  for (const [a, c] of count) if (c > n) (frame = a), (n = c);
  if (!frame || n < min) return null;
  return { sel: selectorOf(doc, frame), items: good.filter((it) => frame.contains(it.el)) };
}

/** The series' and the chapter's names: from the breadcrumbs, the heading, the title, the address. */
function names(doc, url) {
  const u = new URL(url);
  const site = u.hostname.replace(/^www\./, "").split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const siteish = (s) => {
    const k = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return !k || (site && k.includes(site)) || /^(?:home|trang chủ|trang chu|truyện tranh|truyen tranh|manga|manhwa|manhua|comics?)$/i.test(s);
  };
  const h1 = clean(doc.querySelector("h1")?.textContent);
  const og = clean(doc.querySelector('meta[property="og:title"]')?.getAttribute("content"));
  const title = clean(doc.title);
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {}
  let chapter = "";
  for (const s of [h1, og, title, path.replace(/[-_/]+/g, " ")]) {
    const m = CHAP.exec(s || "");
    if (m) {
      chapter = `Chap ${(m[1] || m[2]).replace(",", ".")}`;
      break;
    }
  }
  const crumbs = [...doc.querySelectorAll('.breadcrumb a, .breadcrumbs a, [itemtype*="BreadcrumbList"] a, nav[aria-label*="readcrumb" i] a, .bread-crumb a, .breadcrumb li')]
    .map((a) => clean(a.textContent))
    .filter((s) => s && s.length < 150 && !siteish(s));
  let series = crumbs.filter((c) => !CHAP.test(c)).pop() || "";
  if (!series) {
    for (const s of [h1, og, title]) {
      if (!s) continue;
      const parts = s.split(/\s+[-|–—»:]\s+|\s*\|\s*/).map(clean).filter(Boolean);
      const i = parts.findIndex((p) => CHAP.test(p));
      if (i > 0) {
        series = parts.slice(0, i).filter((p) => !siteish(p)).join(" - ");
      } else if (i === 0) {
        series = clean(parts[0].slice(0, CHAP.exec(parts[0]).index));
      }
      if (series) break;
    }
  }
  if (!series) series = (og || title).split(/\s+[-|–—]\s+/).map(clean).find((p) => !siteish(p)) || u.hostname;
  series = series
    .replace(/^(?:đọc truyện|doc truyen|đọc|read)\s+/i, "")
    .replace(/\s*(?:tiếng việt|vietsub|online|raw|free)\s*$/i, "")
    .replace(/[\s:–—-]+$/, "")
    .trim();
  if (!chapter) chapter = clean(path.split("/").filter(Boolean).pop() || "") || "Chương";
  return { series: series.slice(0, 120), chapter: chapter.slice(0, 80) };
}

/** The link to the next chapter (rel=next, "Chương sau", "Next chapter", a "next" button). */
function nextLink(doc, url) {
  const here = new URL(url);
  const cands = [...doc.querySelectorAll('link[rel~="next"], a[rel~="next"]')].map((el) => ({ el, score: 4 }));
  for (const a of doc.querySelectorAll("a[href]")) {
    const text = clean(`${a.textContent} ${a.getAttribute("title") || ""} ${a.getAttribute("aria-label") || ""}`).toLowerCase();
    const cls = `${typeof a.className === "string" ? a.className : ""} ${a.id}`.toLowerCase();
    let s = 0;
    if (/(?:chap(?:ter)?|chương|chuong|episode|tập)\s*(?:sau|tiếp|kế|next)|next\s*(?:chap|chapter|episode)|chương sau|chap sau|tập sau/.test(text)) s += 6;
    else if (/^(?:next|sau|tiếp|tiếp theo|kế tiếp|›|»|>|→|>>|❯)$/.test(text)) s += 3;
    if (/next|(?:^|[-_ ])sau(?:$|[-_ ])/.test(cls) && !/prev|truoc|trước/.test(cls)) s += 3;
    if (/prev|trước|truoc|previous/.test(`${text} ${cls}`)) s -= 6;
    if (s > 0) cands.push({ el: a, score: s });
  }
  let best = null;
  for (const c of cands) {
    let u;
    try {
      u = new URL(c.el.getAttribute("href"), url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname !== here.hostname || u.href.split("#")[0] === here.href.split("#")[0]) continue;
    if (c.el.closest('[class*="comment" i], [id*="comment" i]')) continue;
    // (a chapter's address has a number in it)
    const score = c.score + (/\d/.test(u.pathname) ? 1 : -2);
    if (!best || score > best.score) best = { score, href: u.href };
  }
  return best && best.score >= 3 ? best.href : "";
}

/** A reader that shows one picture per address: its pages, from the page picker. */
function pageList(doc, url) {
  const host = new URL(url).hostname;
  for (const sel of doc.querySelectorAll("select")) {
    const opts = [...sel.options];
    if (opts.length < 3) continue;
    const urls = opts.map((o) => {
      const v = o.getAttribute("data-url") || o.value || "";
      try {
        const u = new URL(v, url);
        return /^https?:$/.test(u.protocol) && u.hostname === host && /\D/.test(v) ? u.href : "";
      } catch {
        return "";
      }
    });
    const looks = opts.some((o) => /(?:page|trang|\d+\s*\/\s*\d+)/i.test(o.textContent) || /^\s*\d+\s*$/.test(o.textContent));
    if (looks && urls.filter(Boolean).length >= opts.length * 0.8) return [...new Set(urls.filter(Boolean))];
  }
  return [];
}

/** A small picture of a loaded page, for the panel (made here, where the page loaded it with its referrer: the
 * panel itself could not load it from a site that guards its pictures). */
function thumbOf(doc, img, base) {
  try {
    if (!loadedReal(img, base)) return {};
    const w = 96;
    const h = Math.min(160, Math.round((img.naturalHeight / img.naturalWidth) * w)) || 128;
    const c = doc.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, Math.round((img.naturalHeight / img.naturalWidth) * w));
    return { thumb: c.toDataURL("image/jpeg", 0.72) };
  } catch {
    return {};
  }
}

/**
 * The chapter in `doc` (the page as shown, or `live: false` for a fetched one): its pictures in order,
 * names, the reader frame's selector (to find it again in the next chapter), the next chapter's link.
 */
export function scanDocument(doc, url, { live = true, hint = "", min = 3 } = {}) {
  const base = live ? doc.baseURI || url : url;
  const found = byKnownFrame(doc, base, live, hint, min) || (live ? byLargestFrame(doc, base, min) : null);
  const items = (found?.items || []).map(({ url: u, alts, w, h, el }, i) => ({ url: u, ...(alts ? { alts } : {}), w, h, ...(live && i < 150 ? thumbOf(doc, el, base) : {}) }));
  const res = { url, host: new URL(url).hostname, ...names(doc, url), items, selector: found?.sel || "", next: nextLink(doc, url), paged: false, pageUrls: [], pending: 0 };
  if (live && found) res.pending = found.items.filter((it) => !loadedReal(it.el, base)).length;
  if (items.length <= 2) {
    const pages = pageList(doc, url);
    if (pages.length >= 3) Object.assign(res, { paged: true, pageUrls: pages });
  }
  return res;
}

/** How many comic pages the page seems to show (for the address bar's hint; 0: not a comic). */
export function quickCount(doc, url) {
  try {
    const found = byKnownFrame(doc, url, true, "", 4) || byLargestFrame(doc, url, 4);
    return found ? found.items.length : 0;
  } catch {
    return 0;
  }
}

const sleep = (win, ms) => new Promise((r) => win.setTimeout(r, ms));

/** Scrolls down the page and back, so the pictures it loads only when reached are loaded. */
export async function autoScroll(win) {
  const start = win.scrollY;
  const step = Math.max(500, win.innerHeight * 0.9);
  let last = -1;
  let same = 0;
  for (let i = 0; i < 150; i++) {
    win.scrollBy({ top: step, behavior: "instant" });
    await sleep(win, 110);
    const y = win.scrollY;
    if (y === last) {
      if (++same >= 4) break;
    } else same = 0;
    last = y;
  }
  await sleep(win, 500);
  win.scrollTo({ top: start, behavior: "instant" });
}

/** A one-picture-per-address reader's pages: each fetched (with the user's session) and its picture found. */
export async function pagesOf(win, urls, hint) {
  const out = [];
  for (const u of urls.slice(0, 500)) {
    try {
      const res = await win.fetch(u, { credentials: "include" });
      const doc = new win.DOMParser().parseFromString(await res.text(), "text/html");
      const r = scanDocument(doc, u, { live: false, hint, min: 1 });
      if (r.items[0]) out.push(r.items[0]);
    } catch {}
  }
  return out;
}

// (for UnkPageChild, which loads this lazily by this name)
export const MangaScan = { scanDocument, quickCount, autoScroll, pagesOf, realSrc, READERS };

/** Small pictures of pages the page has not loaded yet: each loaded here (as the page loads its own: with its
 * referrer) and drawn small. For the panel's previews; at most 150, six at a time. */
export async function thumbsOf(win, urls) {
  const doc = win.document;
  const list = urls.slice(0, 150);
  const out = [];
  let next = 0;
  const one = (url) =>
    new Promise((ok) => {
      const img = new win.Image();
      const done = (v) => {
        win.clearTimeout(timer);
        ok(v);
      };
      const timer = win.setTimeout(() => done(null), 15000);
      img.onload = () => {
        try {
          const w = 96;
          const h = Math.round((img.naturalHeight / img.naturalWidth) * w) || 128;
          const c = doc.createElement("canvas");
          c.width = w;
          c.height = Math.min(160, h);
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          done(c.toDataURL("image/jpeg", 0.72));
        } catch {
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = url;
    });
  const worker = async () => {
    while (next < list.length) {
      const url = list[next++];
      const thumb = await one(url);
      if (thumb) out.push({ url, thumb });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  return out;
}
MangaScan.thumbsOf = thumbsOf;
