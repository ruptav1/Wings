// "Tải truyện tranh" - the main-process side: a comic chapter's pictures, found in its page by the page side
// (actors/MangaScan.sys.mjs), downloaded with the browser's own session (its cookies, the page as referrer)
// into one ZIP per request, with entries under <series>/<chapter>/. CBZ and folder output are per chapter.
// Each picture is checked to be a picture (an error page saved instead is tried again) and saved as a PNG
// (001.png, 002.png…), decoded and encoded again by Gecko itself; a zip stores them as they are.
// One row in Tải xuống per output, counting pictures. Optionally the chapters after it: the tab goes on to
// the next chapter, which is read the same way (the reader frame found in the first), and so on.
import { Core } from "resource://unknowweb/Core.sys.mjs";

const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});
const sleep = (ms) => new Promise((r) => lazy.setTimeout(r, ms));

let deps = null; // { emit, tabOf(id), hostOf(id), root() }
export function initManga(d) {
  deps = d;
}

const jobs = new Map(); // id -> active download
let seq = 1;
export const isMangaId = (id) => typeof id === "string" && id.startsWith("manga-");

// (at most 4 pictures at once, over all chapters: kind to the site)
const slots = { free: 4, waiting: [] };
async function slot() {
  if (slots.free > 0) return void slots.free--;
  await new Promise((r) => slots.waiting.push(r));
}
function release() {
  const next = slots.waiting.shift();
  if (next) next();
  else slots.free++;
}

function actorOf(tabId) {
  const t = deps.tabOf(tabId);
  return t?.browser?.browsingContext?.currentWindowGlobal?.getActor("UnkPage") || null;
}

/** The chapter shown in the tab (MangaScan.scanDocument's result). */
export async function scanManga(tabId, opts = {}) {
  const a = actorOf(tabId);
  if (!a) throw new Error("Trang chưa sẵn sàng");
  return a.sendQuery("MangaScan", opts);
}

/** Small pictures of the chapter's pages the page has not loaded yet (for the panel). */
export async function thumbsManga(tabId, urls) {
  return (await actorOf(tabId)?.sendQuery("MangaThumbs", { urls })) || [];
}

function safeName(s, fallback, limit = 160) {
  const name = String(s || "").normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
    .replace(/[\uD800-\uDBFF]$/, "")
    .replace(/[. ]+$/, "") || fallback;
  return /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) ? "_" + name : name;
}

/** What the picture really is, by its first bytes (null: not a picture - an error page, most likely). */
function pictureKind(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return ".jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) return ".png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ".gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return ".webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return ".avif";
  if (b[0] === 0x42 && b[1] === 0x4d) return ".bmp";
  return null;
}

const MIME = { ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp" };
const ownBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/** The picture as a PNG (a GIF: its first frame), decoded and encoded by Gecko's own image tools; null when
 * it cannot be turned into one. */
function toPng(bytes, kind) {
  if (kind === ".png") return bytes;
  try {
    const tools = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools);
    const img = tools.decodeImageFromArrayBuffer(ownBuffer(bytes), MIME[kind]);
    const stream = tools.encodeImage(img, "image/png");
    const png = new Uint8Array(lazy.NetUtil.readInputStream(stream, stream.available()));
    stream.close();
    return pictureKind(png) === ".png" ? png : null;
  } catch (e) {
    console.error("unknowweb: comic picture to PNG", e);
    return null;
  }
}

function referrerOf(page) {
  try {
    return new Components.Constructor("@mozilla.org/referrer-info;1", "nsIReferrerInfo", "init")(Ci.nsIReferrerInfo.EMPTY, true, Services.io.newURI(page));
  } catch {
    return null;
  }
}

function dataBytes(url) {
  const [head, body = ""] = url.split(",", 2);
  if (/;base64/i.test(head)) return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(body));
}

function payload(job) {
  return {
    id: job.id,
    own: true,
    unit: "pages",
    url: job.page,
    path: job.out || job.dir,
    file: PathUtils.filename(job.out || job.dir),
    started: job.started,
    ...(job.ended ? { ended: job.ended } : {}),
    private: job.run.private,
    state: job.state,
    received: job.done,
    total: job.total,
    failed: job.failed,
  };
}
function report(job, force = false) {
  const now = Date.now();
  if (!force && now - job.last < 250) return;
  job.last = now;
  deps.emit("download", payload(job));
}

/** An entry of the chapter's zip, stored as it is (a PNG is squeezed already). */
function addEntry(zip, name, bytes, compression = Ci.nsIZipWriter.COMPRESSION_NONE) {
  const buf = ownBuffer(bytes);
  const stream = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(Ci.nsIArrayBufferInputStream);
  stream.setData(buf, 0, buf.byteLength);
  zip.addEntryStream(name, Date.now() * 1000, compression, stream, false);
}

/** One picture, saved as <number>.png into the chapter's zip or folder; true when it is there. Tried from its
 * own address, then the other servers the site named for it (Vietnamese readers keep backups in data-cdn,
 * data-sv1…), then its own once more - up to five tries. It comes into a file of its own beside where it
 * goes (<file>.part-007), read back and removed at once. */
async function fetchOne(job, item, index, width, page, prefix) {
  const name = String(index + 1).padStart(width, "0");
  const order = [item.url, ...(item.alts || [])].filter((u) => typeof u === "string" && /^(?:https?|data|blob):/i.test(u));
  if (!order.length) return false;
  const tries = Math.min(5, Math.max(3, order.length + 1));
  const tmp = job.ext ? `${job.part}-${name}` : PathUtils.join(job.dir, `${name}.part`);
  for (let attempt = 0; attempt < tries && !job.run.cancelled; attempt++) {
    const url = order[attempt % order.length];
    try {
      let bytes;
      if (url.startsWith("data:")) bytes = dataBytes(url);
      else if (url.startsWith("blob:")) {
        const got = await actorOf(job.run.tab)?.sendQuery("MangaFetch", { url });
        if (!got) throw new Error("blob");
        bytes = new Uint8Array(got);
      } else {
        const d = await lazy.Downloads.createDownload({ source: { url, isPrivate: job.run.private, referrerInfo: referrerOf(page) }, target: tmp });
        if (job.run.cancelled) return false;
        job.live.add(d);
        try {
          await d.start();
        } finally {
          job.live.delete(d);
        }
        bytes = await IOUtils.read(tmp);
        await IOUtils.remove(tmp, { ignoreAbsent: true });
      }
      const kind = pictureKind(bytes);
      if (!kind) throw new Error("not a picture");
      // (as it came only when it cannot be turned into a PNG: better than losing the page)
      const png = toPng(bytes, kind);
      const file = name + (png ? ".png" : kind);
      if (job.run.cancelled) break;
      if (job.zip) addEntry(job.zip, prefix + file, png || bytes);
      else await IOUtils.write(PathUtils.join(job.dir, file), png || bytes);
      return true;
    } catch {
      await IOUtils.remove(tmp, { ignoreAbsent: true }).catch(() => {});
      if (job.run.cancelled) break;
      // (another server next: no need to wait; the same one again: a moment)
      if (order.length === 1 || attempt + 1 >= order.length) await sleep(1500 * (attempt + 1));
    }
  }
  return false;
}

const xmlEscape = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

/** A .cbz's ComicInfo.xml, which comic readers (Komga, Kavita, Mihon…) read the series and the chapter's
 * number from. */
function comicInfo(job) {
  const num = /(\d+(?:\.\d+)?)/.exec(job.chapter)?.[1] || "";
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <Series>${xmlEscape(job.run.series)}</Series>`,
    `  <Title>${xmlEscape(job.chapter)}</Title>`,
    ...(num ? [`  <Number>${num}</Number>`] : []),
    `  <PageCount>${job.done}</PageCount>`,
    `  <Web>${xmlEscape(job.page)}</Web>`,
    "</ComicInfo>",
    "",
  ].join("\n");
  return new TextEncoder().encode(xml);
}

/** Close the archive before publishing it in the download folder. */
async function finishZip(job) {
  if (job.ext === ".cbz") addEntry(job.zip, "ComicInfo.xml", comicInfo(job), Ci.nsIZipWriter.COMPRESSION_DEFAULT);
  job.zip.close();
  job.zip = null;
  for (let i = 0; ; i++) {
    const target = i ? job.out.replace(/(\.[a-z]+)$/i, ` (${i})$1`) : job.out;
    try {
      // ZIP batches with the same series name can contain different chapters.
      await IOUtils.move(job.part, target, { noOverwrite: job.ext === ".zip" || i > 0 });
      job.out = target;
      return;
    } catch (error) {
      if (!(await IOUtils.exists(target)) || i >= 999) throw error;
    }
  }
}

async function downloadChapter(job, ch, chapter) {
  let prefix = "";
  if (job.ext === ".zip") {
    let dir = chapter;
    for (let n = 2; job.chapterDirs.has(dir.toUpperCase()); n++) dir = `${chapter} (${n})`;
    job.chapterDirs.add(dir.toUpperCase());
    prefix = `${job.run.series}/${dir}/`;
  }
  let items = ch.items || [];
  if (ch.paged && ch.pageUrls?.length && !items.length) {
    items = (await actorOf(job.run.tab)?.sendQuery("MangaPages", { urls: ch.pageUrls, hint: ch.selector })) || [];
  }
  job.total += items.length;
  report(job, true);
  const width = Math.max(3, String(items.length).length);
  let next = 0;
  const worker = async () => {
    while (!job.run.cancelled && next < items.length) {
      const i = next++;
      await slot();
      try {
        if (job.run.cancelled) return;
        (await fetchOne(job, items[i], i, width, ch.page, prefix)) ? job.done++ : job.failed++;
      } finally {
        release();
      }
      report(job);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function finishJob(job) {
  jobs.delete(job.id);
  let kept = job.done > 0 && !job.run.cancelled;
  if (job.ext) {
    try {
      if (!kept) throw new Error("nothing to keep");
      await finishZip(job);
    } catch (e) {
      if (kept) console.error("unknowweb: comic chapter, packing", e);
      kept = false;
      try {
        job.zip?.close();
      } catch {}
      job.zip = null;
      await IOUtils.remove(job.part, { ignoreAbsent: true }).catch(() => {});
    }
  } else if (!job.done) {
    // (a folder that got nothing)
    await IOUtils.remove(job.dir, { ignoreAbsent: true }).catch(() => {});
  }
  job.state = job.run.cancelled ? "cancelled" : kept ? "completed" : "interrupted";
  job.ended = Date.now();
  report(job, true);
  if (!job.run.private) {
    try {
      Core.call("download_record", { item: payload(job) });
    } catch {}
  }
}

function newJob(run, chapter, page) {
  const id = `manga-${Date.now().toString(36)}-${seq++}`;
  const base = run.format === "zip" && run.more
    ? run.series
    : safeName(`${safeName(run.series, "Truyện tranh", 100)} - ${safeName(chapter, "Chương", 60)}`, chapter);
  const ext = run.format === "folder" ? "" : `.${run.format}`;
  const out = ext ? PathUtils.join(run.root, base + ext) : "";
  const job = {
    id,
    run,
    chapter,
    page,
    chapterDirs: new Set(),
    ext,
    dir: ext ? "" : PathUtils.join(run.root, base),
    out,
    part: out ? PathUtils.join(run.root, `${id}.part`) : "",
    zip: null,
    total: 0,
    done: 0,
    failed: 0,
    state: "progressing",
    started: Date.now(),
    last: 0,
    live: new Set(),
  };
  jobs.set(id, job);
  report(job, true);
  return job;
}

/** Sends the tab to `url` and waits until its page has loaded (and a moment for its scripts). */
async function goTo(run, url) {
  const t = deps.tabOf(run.tab);
  const host = deps.hostOf(run.tab);
  if (!t?.browser || !host) return false;
  const before = t.browser.currentURI?.spec || "";
  host.load(t, url);
  const t0 = Date.now();
  await sleep(800);
  while (!run.cancelled && Date.now() - t0 < 45000) {
    const b = t.browser;
    if (!b?.isConnected) return false;
    const spec = b.currentURI?.spec || "";
    if (!b.webProgress?.isLoadingDocument && spec !== before && spec !== "about:blank") {
      await sleep(1500);
      return true;
    }
    await sleep(300);
  }
  return false;
}

/**
 * Starts downloading the chapter the panel showed (the user's names and choice of pictures), then, `next`
 * times, the chapter after it. Returns the first chapter's row id.
 */
export function startManga(a) {
  const run = {
    tab: a.tab,
    private: !!a.private,
    series: safeName(a.series, "Truyện tranh"),
    root: deps.root(),
    scroll: !!a.scroll,
    format: ["zip", "cbz", "folder"].includes(a.format) ? a.format : "zip",
    cancelled: false,
    more: Math.max(0, Math.min(200, Math.trunc(Number(a.next) || 0))),
  };
  let chapter = safeName(a.chapter, "Chương 1", 80);
  const first = newJob(run, chapter, a.page);
  (async () => {
    let job = first;
    let ch = { ...a, next: a.nextUrl };
    const seen = new Set([a.page]);
    try {
      for (let i = 0; ; i++) {
        if (!job) job = newJob(run, chapter, ch.page);
        if (job.ext && !job.zip) {
          job.zip = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
          job.zip.open(new FileUtils.File(job.part), 0x04 | 0x08 | 0x20);
        } else if (!job.ext) {
          await IOUtils.makeDirectory(job.dir, { createAncestors: true, ignoreExisting: true });
        }
        await downloadChapter(job, ch, chapter);
        if (run.format !== "zip") {
          await finishJob(job);
          job = null;
        }
        if (i >= run.more || !ch.next || seen.has(ch.next) || run.cancelled) break;
        seen.add(ch.next);
        if (!(await goTo(run, ch.next)) || run.cancelled) break;
        const scan = await scanManga(run.tab, { scroll: run.scroll, hint: ch.selector });
        if (run.cancelled || (!scan.items.length && !scan.paged)) break;
        ch = { ...scan, page: scan.url, selector: scan.selector || ch.selector };
        chapter = safeName(scan.chapter, `Chương ${i + 2}`, 80);
      }
    } catch (e) {
      console.error("unknowweb: comic download", e);
    } finally {
      if (job) await finishJob(job);
    }
  })();
  return first.id;
}

/** Stops a chapter's run: it, and the chapters after it in the same run. */
export function cancelManga(id) {
  const job = jobs.get(id);
  if (!job) return;
  job.run.cancelled = true;
  for (const d of job.live) d.finalize(true).catch(() => {});
}
