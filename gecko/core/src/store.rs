//! The user's data, kept in TyranWeb's own files and formats, so either browser can use the other's
//! data folder: settings.json, history.json, bookmarks.json, downloads.json, session.json,
//! window-history.json, window-state.json, scan-history.json, notes.json. Each is written whole
//! (compact JSON, through a .tmp file) with the copy before kept as .bak, and read back from the .bak
//! when the file itself is missing or broken, as TyranWeb does. In memory they keep the shapes the
//! interface works with; they are turned into TyranWeb's on the way to disk and back (the browser's
//! own pages are unk:// here and tyran:// in the files; a tab's back / forward list counts from 0
//! there and from 1 in the engine).
//!
//! Where the data lives: <profile>/data, or the folder named in <profile>/data-folder.json
//! ({"dir": "..."}, as TyranWeb's), which can be TyranWeb's own data folder. An import asked for
//! ({"import": "..."}) copies that folder's files in at the next start.
//!
//! Writes are batched: a change marks the document dirty and a background thread saves it a moment
//! later (and everything is saved on exit), so typing in Settings does not hit the disk on each key.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// An id as TyranWeb makes them: a letter and 12 hex digits.
pub fn uid(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let mut x = now_ms() ^ (std::process::id() as u64).rotate_left(32) ^ n.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
    x ^= x >> 29;
    format!("{prefix}{:012x}", x & 0xffff_ffff_ffff)
}

/// Objects merge key by key; anything else (arrays included) is replaced.
pub fn deep_merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                if k == "__proto__" || k == "constructor" || k == "prototype" {
                    continue;
                }
                match b.get_mut(k) {
                    Some(slot) if slot.is_object() && v.is_object() => deep_merge(slot, v),
                    _ => {
                        b.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (b, p) => *b = p.clone(),
    }
}

/// Keys missing from `target` filled in from `defaults` (objects key by key); what it has is kept.
pub fn fill_defaults(target: &mut Value, defaults: &Value) {
    if let (Value::Object(t), Value::Object(d)) = (target, defaults) {
        for (k, v) in d {
            match t.get_mut(k) {
                Some(slot) => {
                    if slot.is_object() && v.is_object() {
                        fill_defaults(slot, v);
                    }
                }
                None => {
                    t.insert(k.clone(), v.clone());
                }
            }
        }
    }
}

fn bak(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".bak");
    PathBuf::from(s)
}

/// A JSON file, or its .bak when the file is missing or broken.
pub fn read_json(path: &Path) -> Option<Value> {
    for p in [path.to_path_buf(), bak(path)] {
        if let Some(v) = fs::read(&p).ok().and_then(|b| serde_json::from_slice::<Value>(strip_bom(&b)).ok()) {
            return Some(v);
        }
    }
    None
}
fn strip_bom(b: &[u8]) -> &[u8] {
    b.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(b)
}

/// Written whole through a .tmp file; the copy before becomes the .bak.
pub fn write_json(path: &Path, v: &Value) {
    let Ok(bytes) = serde_json::to_vec(v) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    if fs::write(&tmp, &bytes).is_err() {
        return;
    }
    if path.exists() {
        let _ = fs::copy(path, bak(path));
    }
    // (another program holding the file a moment: tried again shortly)
    for i in 0..5 {
        if fs::rename(&tmp, path).is_ok() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(60 * (i + 1)));
    }
    let _ = fs::remove_file(&tmp);
}

// ---------- addresses: unk:// in memory, tyran:// in the files ----------
const PAGE_ROOT: &str = "chrome://unknowweb/content/ui/pages/";
const SHELL_PAGES: [&str; 8] = ["newtab", "settings", "history", "bookmarks", "downloads", "taskmgr", "store", "scan"];

fn page_name(s: &str) -> Option<(&str, &str)> {
    let end = s.find(|c: char| !c.is_ascii_alphabetic()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    Some((&s[..end], &s[end..]))
}

/// One address on its way to disk (`entry`: in a tab's back / forward list, where the engine keeps
/// its pages' real addresses).
fn url_to_disk(s: &str) -> Option<String> {
    if let Some(rest) = s.strip_prefix("unk://") {
        return Some(format!("tyran://{rest}"));
    }
    if let Some(rest) = s.strip_prefix(PAGE_ROOT) {
        let (name, after) = page_name(rest)?;
        let after = after.strip_prefix("/index.html").unwrap_or(after);
        let after = after.trim_start_matches('/');
        return Some(format!("tyran://{name}/{after}"));
    }
    if let Some(rest) = s.strip_prefix("resource://unktyran/") {
        return Some(format!("tyran://userdata/{rest}"));
    }
    None
}
fn url_from_disk(s: &str, entry: bool) -> Option<String> {
    let rest = s.strip_prefix("tyran://")?;
    if let Some(r) = rest.strip_prefix("userdata/") {
        return Some(format!("resource://unktyran/{r}"));
    }
    let (name, after) = page_name(rest)?;
    let name_l = name.to_ascii_lowercase();
    if name_l == "assets" || name_l == "app" || name_l == "shared" || name_l == "linked" || name_l == "fonts" {
        return None;
    }
    if entry {
        let page = if SHELL_PAGES.contains(&name_l.as_str()) { name_l.as_str() } else { "newtab" };
        return Some(format!("{PAGE_ROOT}{page}/index.html{}", after.trim_start_matches('/')));
    }
    Some(format!("unk://{rest}"))
}

/// Every address in a document, one way or the other (inside "entries": a tab's back / forward list).
fn map_urls(v: &mut Value, to_disk: bool, entry: bool) {
    match v {
        Value::String(s) => {
            let m = if to_disk { url_to_disk(s) } else { url_from_disk(s, entry) };
            if let Some(m) = m {
                *s = m;
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| map_urls(x, to_disk, entry)),
        Value::Object(o) => {
            // (keys that are addresses too: a picture's frame, a wallpaper's music "video:<address>")
            let moved: Vec<(String, String)> = o.keys().filter_map(|k| key_map(k, to_disk).map(|m| (k.clone(), m))).collect();
            for (k, m) in moved {
                if let Some(v) = o.remove(&k) {
                    o.insert(m, v);
                }
            }
            for (k, x) in o.iter_mut() {
                map_urls(x, to_disk, entry || k == "entries");
            }
        }
        _ => {}
    }
}

fn key_map(k: &str, to_disk: bool) -> Option<String> {
    let (pre, rest) = match k.split_once(':') {
        Some((p, rest)) if ["image", "video", "web"].contains(&p) => (format!("{p}:"), rest),
        _ => (String::new(), k),
    };
    let m = if to_disk { url_to_disk(rest) } else { url_from_disk(rest, false) }?;
    Some(format!("{pre}{m}"))
}

/// The tabs' back / forward lists: the engine's (counted from 1) <-> TyranWeb's (counted from 0).
fn shift_tabs(list: &mut Value, to_disk: bool) {
    for t in list.as_array_mut().into_iter().flatten() {
        let h = &mut t["history"];
        if let Some(i) = h["index"].as_i64() {
            let n = h["entries"].as_array().map_or(0, |e| e.len() as i64);
            h["index"] = json!(if to_disk { (i - 1).clamp(0, (n - 1).max(0)) } else { (i + 1).clamp(1, n.max(1)) });
        }
    }
}

// ---------- documents ----------
#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Plain,
    Settings,
    Downloads,
    Sessions,
}

pub struct Doc {
    pub value: Value,
    path: PathBuf,
    kind: Kind,
    dirty: bool,
}

/// TyranWeb's download record <-> the interface's.
fn download_from_disk(mut d: Value) -> Value {
    let Some(o) = d.as_object_mut() else { return d };
    for (from, to) in [("filename", "file"), ("receivedBytes", "received"), ("totalBytes", "total"), ("startTime", "started"), ("endTime", "ended")] {
        if let Some(x) = o.remove(from) {
            o.insert(to.into(), x);
        }
    }
    if o.get("paused").and_then(Value::as_bool) == Some(true) && o.get("state").and_then(Value::as_str) != Some("completed") {
        o.insert("state".into(), json!("paused"));
    }
    o.remove("paused");
    d
}
fn download_to_disk(d: &Value) -> Value {
    let mut out = Map::new();
    let paused = d["state"] == "paused";
    out.insert("id".into(), d["id"].clone());
    out.insert("url".into(), d["url"].clone());
    out.insert("filename".into(), d["file"].clone());
    out.insert("path".into(), d["path"].clone());
    out.insert("mime".into(), if d["mime"].is_string() { d["mime"].clone() } else { json!("") });
    out.insert("totalBytes".into(), d["total"].clone());
    out.insert("receivedBytes".into(), d["received"].clone());
    out.insert("state".into(), if paused { json!("interrupted") } else { d["state"].clone() });
    out.insert("paused".into(), json!(paused));
    out.insert("canResume".into(), json!(d["canResume"].as_bool().unwrap_or(false)));
    out.insert("startTime".into(), d["started"].clone());
    out.insert("endTime".into(), d["ended"].clone());
    out.insert("private".into(), json!(d["private"].as_bool().unwrap_or(false)));
    // (what only this browser keeps: why it stopped, the check of the file)
    if let Some(o) = d.as_object() {
        for (k, v) in o {
            if !["id", "url", "file", "path", "mime", "total", "received", "state", "canResume", "started", "ended", "private"].contains(&k.as_str()) {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    Value::Object(out)
}

fn label_no(label: &str) -> u64 {
    label.rsplit('-').next().and_then(|n| n.parse().ok()).unwrap_or(u64::MAX)
}
/// The windows in the order they were opened (the main window first).
fn window_order(m: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let mut v: Vec<_> = m.iter().collect();
    v.sort_by_key(|(k, _)| label_no(k));
    v
}
fn bounds_to_disk(b: &Value) -> Value {
    if !b.is_object() {
        return Value::Null;
    }
    json!({ "x": b["x"], "y": b["y"], "width": b["w"], "height": b["h"] })
}
fn bounds_from_disk(b: &Value, maximized: bool) -> Value {
    if !b.is_object() {
        return if maximized { json!({ "maximized": true }) } else { Value::Null };
    }
    {
        let pick = |a: &str, b2: &str| if b[a].is_null() { b[b2].clone() } else { b[a].clone() };
        json!({ "x": b["x"], "y": b["y"], "w": pick("width", "w"), "h": pick("height", "h"), "maximized": maximized || b["maximized"].as_bool().unwrap_or(false) })
    }
}

/// session.json + window-history.json + window-state.json -> the interface's sessions document
/// ({windows: {label: {tabs, active, bounds}}, closed, closedWindows}).
fn sessions_from_disk(dir: &Path) -> Option<Value> {
    let session = read_json(&dir.join("session.json"));
    let history = read_json(&dir.join("window-history.json"));
    let state = read_json(&dir.join("window-state.json"));
    if session.is_none() && history.is_none() {
        return None;
    }
    let mut session = session.unwrap_or_else(|| json!({}));
    map_urls(&mut session, false, false);
    let mut windows = Map::new();
    let list = session["windows"].as_array().cloned().unwrap_or_default();
    for (i, mut w) in list.into_iter().enumerate() {
        shift_tabs(&mut w["tabs"], false);
        let b = if w["bounds"].is_object() {
            bounds_from_disk(&w["bounds"], false)
        } else if i == 0 {
            state.as_ref().map(|s| bounds_from_disk(&s["bounds"], s["maximized"].as_bool().unwrap_or(false))).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        if !b.is_null() {
            w["bounds"] = b;
        }
        windows.insert(format!("win-{}", i + 1), w);
    }
    let mut closed = session["closed"].clone();
    if !closed.is_array() {
        closed = json!([]);
    }
    shift_tabs(&mut closed, false);
    let mut gone = vec![];
    if let Some(mut h) = history {
        map_urls(&mut h, false, false);
        for mut g in h["items"].as_array().cloned().unwrap_or_default() {
            shift_tabs(&mut g["tabs"], false);
            let mut w = json!({ "id": g["id"], "closedAt": g["at"], "active": g["active"], "tabs": g["tabs"] });
            if let Some(o) = g.as_object() {
                for (k, v) in o {
                    if !["id", "at", "active", "tabs"].contains(&k.as_str()) {
                        w[k] = v.clone();
                    }
                }
            }
            gone.push(w);
        }
    }
    Some(json!({ "windows": windows, "closed": closed, "closedWindows": gone }))
}

fn sessions_to_disk(dir: &Path, v: &Value) {
    let mut windows = vec![];
    let mut main_bounds = Value::Null;
    if let Some(m) = v["windows"].as_object() {
        for (i, (_, w)) in window_order(m).into_iter().enumerate() {
            let mut w = w.clone();
            if i == 0 {
                main_bounds = w["bounds"].clone();
            }
            let b = w["bounds"].clone();
            if b.is_object() {
                let mut d = bounds_to_disk(&b);
                d["maximized"] = json!(b["maximized"].as_bool().unwrap_or(false));
                w["bounds"] = d;
            }
            shift_tabs(&mut w["tabs"], true);
            windows.push(w);
        }
    }
    let mut closed = v["closed"].clone();
    if !closed.is_array() {
        closed = json!([]);
    }
    shift_tabs(&mut closed, true);
    let mut session = json!({ "windows": windows, "closed": closed });
    map_urls(&mut session, true, false);
    write_json(&dir.join("session.json"), &session);

    let items: Vec<Value> = v["closedWindows"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .take(40)
        .map(|mut w| {
            shift_tabs(&mut w["tabs"], true);
            let mut g = json!({ "id": w["id"].as_str().map(String::from).unwrap_or_else(|| uid("g")), "at": w["closedAt"], "tabs": w["tabs"], "active": w["active"].as_u64().unwrap_or(0) });
            if let Some(o) = w.as_object() {
                for (k, x) in o {
                    if !["id", "closedAt", "active", "tabs"].contains(&k.as_str()) {
                        g[k] = x.clone();
                    }
                }
            }
            g
        })
        .collect();
    let mut history = json!({ "items": items });
    map_urls(&mut history, true, false);
    write_json(&dir.join("window-history.json"), &history);

    if main_bounds.is_object() {
        let b = bounds_to_disk(&main_bounds);
        let state = json!({ "bounds": if b["width"].is_null() { Value::Null } else { b }, "maximized": main_bounds["maximized"].as_bool().unwrap_or(false) });
        write_json(&dir.join("window-state.json"), &state);
    }
}

impl Doc {
    /// `default`: what a missing file (or missing keys, for objects) falls back to.
    pub fn load(path: PathBuf, default: Value) -> Doc {
        Doc::load_kind(path, default, Kind::Plain)
    }
    pub fn load_kind(path: PathBuf, default: Value, kind: Kind) -> Doc {
        let saved = match kind {
            Kind::Sessions => path.parent().and_then(sessions_from_disk),
            _ => read_json(&path),
        };
        let saved = saved.map(|mut v| {
            match kind {
                Kind::Settings | Kind::Plain => map_urls(&mut v, false, false),
                Kind::Downloads => {
                    if let Some(items) = v["items"].as_array_mut() {
                        for d in items.iter_mut() {
                            *d = download_from_disk(std::mem::take(d));
                        }
                    }
                }
                Kind::Sessions => {}
            }
            v
        });
        let value = match saved {
            // (what is missing filled in from the defaults, as TyranWeb does: the file keeps its own order)
            Some(mut saved) if default.is_object() && saved.is_object() => {
                fill_defaults(&mut saved, &default);
                saved
            }
            Some(saved) => saved,
            None => default,
        };
        Doc { value, path, kind, dirty: false }
    }
    pub fn touch(&mut self) {
        self.dirty = true;
    }
    pub fn save_if_dirty(&mut self) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        match self.kind {
            Kind::Sessions => {
                if let Some(dir) = self.path.parent() {
                    sessions_to_disk(dir, &self.value);
                }
            }
            Kind::Downloads => {
                let items: Vec<Value> = self.value["items"].as_array().map(|a| a.iter().map(download_to_disk).collect()).unwrap_or_default();
                write_json(&self.path, &json!({ "items": items }));
            }
            Kind::Settings | Kind::Plain => {
                let mut v = self.value.clone();
                map_urls(&mut v, true, false);
                write_json(&self.path, &v);
            }
        }
    }
}

// ---------- the history ----------
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Visit {
    #[serde(default)]
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub favicon: String,
    #[serde(rename = "time", alias = "ts", default)]
    pub ts: u64,
}

const HISTORY_CAP: usize = 40_000;

pub struct History {
    pub visits: Vec<Visit>, // oldest first
    path: PathBuf,
    dirty: bool,
}

#[derive(Serialize, Clone)]
pub struct Suggestion {
    pub url: String,
    pub title: String,
    pub favicon: String,
    pub count: u32,
    pub last: u64,
}

pub(crate) fn fold(s: &str) -> String {
    // lowercase, Vietnamese marks off (so "tieng viet" finds "Tiếng Việt"), marks written apart too
    s.to_lowercase()
        .chars()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .map(|c| match c {
            'à' | 'á' | 'ả' | 'ã' | 'ạ' | 'ă' | 'ằ' | 'ắ' | 'ẳ' | 'ẵ' | 'ặ' | 'â' | 'ầ' | 'ấ' | 'ẩ' | 'ẫ' | 'ậ' => 'a',
            'è' | 'é' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ế' | 'ể' | 'ễ' | 'ệ' => 'e',
            'ì' | 'í' | 'ỉ' | 'ĩ' | 'ị' => 'i',
            'ò' | 'ó' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ố' | 'ổ' | 'ỗ' | 'ộ' | 'ơ' | 'ờ' | 'ớ' | 'ở' | 'ỡ' | 'ợ' => 'o',
            'ù' | 'ú' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ứ' | 'ử' | 'ữ' | 'ự' => 'u',
            'ỳ' | 'ý' | 'ỷ' | 'ỹ' | 'ỵ' => 'y',
            'đ' => 'd',
            c => c,
        })
        .collect()
}

// ---------- Lịch sử's list (main/histquery.js in TyranWeb; Ẩn danh's is the same, in PrivHistory.sys.mjs) ----------
// The words typed, in any order, with or without marks, in the title or the address ("site:x.com"
// among them keeps that site and its subdomains, only it with exact); a time span; one page.

/// The site of an address, without "www.".
pub(crate) fn host_of(url: &str) -> String {
    let Some(i) = url.find("://") else { return String::new() };
    let rest = url[i + 3..].split(['/', '?', '#']).next().unwrap_or("");
    let rest = rest.rsplit('@').next().unwrap_or(rest);
    let host = rest.split(':').next().unwrap_or("").to_lowercase();
    host.strip_prefix("www.").map(str::to_string).unwrap_or(host)
}

fn clean_host(s: &str) -> String {
    let s = s.trim().to_lowercase();
    let s = match s.find("://") {
        Some(i) => s[i + 3..].to_string(),
        None => s,
    };
    let s = s.strip_prefix("www.").map(str::to_string).unwrap_or(s);
    s.split(['/', ':', '?', '#']).next().unwrap_or("").to_string()
}

/// An address with its %-escapes read (a search for "bún" finds "?q=b%C3%BAn").
fn decoded(url: &str) -> String {
    if !url.contains('%') {
        return url.to_string();
    }
    let hex = |b: u8| match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    };
    let b = url.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hay(v: &Visit) -> String {
    fold(&format!("{} {}", v.title, decoded(&v.url)))
}

pub struct Filter {
    words: Vec<String>,
    site: String,
    exact: bool,
    since: u64,
    until: u64,
    url: String,
}

impl Filter {
    pub fn from(f: &Value) -> Filter {
        let mut words = vec![];
        let mut site = clean_host(f["host"].as_str().unwrap_or(""));
        for w in f["text"].as_str().unwrap_or("").split_whitespace() {
            match w.strip_prefix("site:").or_else(|| w.strip_prefix("SITE:")) {
                Some(s) if !s.is_empty() => site = clean_host(s),
                _ => words.push(fold(w)),
            }
        }
        Filter { words, site, exact: f["exact"].as_bool().unwrap_or(false), since: f["since"].as_u64().unwrap_or(0), until: f["until"].as_u64().unwrap_or(0), url: f["url"].as_str().unwrap_or("").to_string() }
    }
    pub fn ok(&self, v: &Visit) -> bool {
        if self.since > 0 && v.ts < self.since || self.until > 0 && v.ts >= self.until {
            return false;
        }
        if !self.url.is_empty() && v.url != self.url {
            return false;
        }
        if !self.site.is_empty() {
            let h = host_of(&v.url);
            if h != self.site && (self.exact || !h.ends_with(&format!(".{}", self.site))) {
                return false;
            }
        }
        if !self.words.is_empty() {
            let s = hay(v);
            if !self.words.iter().all(|w| s.contains(w.as_str())) {
                return false;
            }
        }
        true
    }
}

fn name_key(v: &Visit) -> String {
    let t = if v.title.is_empty() { &v.url } else { &v.title };
    fold(t).trim_start_matches(|c: char| !c.is_alphanumeric()).to_string()
}

/// { rows, total, count }: the visits matching (newest or oldest first, by name, or each page once
/// with how many times it was opened, the most first); total: how many match (what deleting them
/// takes away); count: the rows there are to page through.
pub fn find_in(visits: &[Visit], f: &Value) -> Value {
    let flt = Filter::from(f);
    let sort = f["sort"].as_str().unwrap_or("new");
    let limit = f["limit"].as_u64().unwrap_or(120).clamp(1, 2000) as usize;
    let offset = f["offset"].as_u64().unwrap_or(0) as usize;
    if sort == "new" || sort == "old" {
        let mut rows = vec![];
        let mut total = 0usize;
        let order: Box<dyn Iterator<Item = &Visit>> = if sort == "new" { Box::new(visits.iter().rev()) } else { Box::new(visits.iter()) };
        for v in order {
            if !flt.ok(v) {
                continue;
            }
            if total >= offset && rows.len() < limit {
                rows.push(json!(v));
            }
            total += 1;
        }
        return json!({ "rows": rows, "total": total, "count": total });
    }
    let hits: Vec<&Visit> = visits.iter().filter(|v| flt.ok(v)).collect();
    let total = hits.len();
    let list: Vec<Value> = if sort == "most" {
        let mut by: HashMap<&str, (&Visit, u64)> = HashMap::new();
        for v in &hits {
            let e = by.entry(v.url.as_str()).or_insert((v, 0));
            e.1 += 1;
            if v.ts >= e.0.ts {
                e.0 = v;
            }
        }
        let mut l: Vec<(&Visit, u64)> = by.into_values().collect();
        l.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.ts.cmp(&a.0.ts)));
        l.into_iter()
            .map(|(v, n)| {
                let mut o = json!(v);
                o["visits"] = json!(n);
                o
            })
            .collect()
    } else {
        let mut l: Vec<(String, &Visit)> = hits.iter().map(|v| (name_key(v), *v)).collect();
        l.sort_by(|a, b| a.0.cmp(&b.0));
        if sort == "za" {
            l.reverse();
        }
        l.into_iter().map(|(_, v)| json!(v)).collect()
    };
    let count = list.len();
    json!({ "rows": list.into_iter().skip(offset).take(limit).collect::<Vec<_>>(), "total": total, "count": count })
}

/// The sites of the visits matching: { rows: [{ host, visits, last, title, favicon }], total, count },
/// the most visited first, or the fewest, the latest, by name.
pub fn domains_in(visits: &[Visit], f: &Value) -> Value {
    let flt = Filter::from(f);
    let sort = f["sort"].as_str().unwrap_or("most");
    let limit = f["limit"].as_u64().unwrap_or(300).clamp(1, 5000) as usize;
    let offset = f["offset"].as_u64().unwrap_or(0) as usize;
    struct D {
        host: String,
        visits: u64,
        last: u64,
        title: String,
        favicon: String,
    }
    let mut by: HashMap<String, D> = HashMap::new();
    let mut total = 0usize;
    for v in visits {
        if !flt.ok(v) {
            continue;
        }
        total += 1;
        let host = host_of(&v.url);
        if host.is_empty() {
            continue;
        }
        let d = by.entry(host.clone()).or_insert(D { host, visits: 0, last: 0, title: String::new(), favicon: String::new() });
        d.visits += 1;
        if v.ts >= d.last {
            d.last = v.ts;
            if !v.title.is_empty() {
                d.title = v.title.clone();
            }
            if !v.favicon.is_empty() {
                d.favicon = v.favicon.clone();
            }
        } else if d.favicon.is_empty() && !v.favicon.is_empty() {
            d.favicon = v.favicon.clone();
        }
    }
    let mut l: Vec<D> = by.into_values().collect();
    match sort {
        "least" => l.sort_by(|a, b| a.visits.cmp(&b.visits).then(b.last.cmp(&a.last))),
        "recent" => l.sort_by(|a, b| b.last.cmp(&a.last)),
        "az" | "za" => {
            l.sort_by_cached_key(|d| fold(&d.host));
            if sort == "za" {
                l.reverse();
            }
        }
        _ => l.sort_by(|a, b| b.visits.cmp(&a.visits).then(b.last.cmp(&a.last))),
    }
    let count = l.len();
    let rows: Vec<Value> = l.into_iter().skip(offset).take(limit).map(|d| json!({ "host": d.host, "visits": d.visits, "last": d.last, "title": d.title, "favicon": d.favicon })).collect();
    json!({ "rows": rows, "total": total, "count": count })
}

impl History {
    /// TyranWeb's {visits: [{id, url, title, favicon, time}]} (or this browser's older plain list).
    pub fn load(path: PathBuf) -> History {
        let raw = read_json(&path).unwrap_or(Value::Null);
        let (list, old) = match raw {
            Value::Object(mut o) => (o.remove("visits").unwrap_or(Value::Null), false),
            v @ Value::Array(_) => (v, true),
            _ => (Value::Null, false),
        };
        let mut visits: Vec<Visit> = serde_json::from_value(list).unwrap_or_default();
        for v in visits.iter_mut().filter(|v| v.id.is_empty()) {
            v.id = uid("h");
        }
        History { visits, path, dirty: old }
    }
    pub fn add(&mut self, url: &str, title: &str, favicon: &str) {
        let ts = now_ms();
        // the same page again within half an hour (a reload, a redirect back): one visit
        if let Some(last) = self.visits.iter_mut().rev().take(20).find(|v| v.url == url) {
            if ts - last.ts < 30 * 60 * 1000 {
                last.ts = ts;
                if !title.is_empty() {
                    last.title = title.to_string();
                }
                if !favicon.is_empty() {
                    last.favicon = favicon.to_string();
                }
                self.dirty = true;
                return;
            }
        }
        self.visits.push(Visit { id: uid("h"), url: url.to_string(), title: if title.is_empty() { url.to_string() } else { title.to_string() }, favicon: favicon.to_string(), ts });
        if self.visits.len() > HISTORY_CAP {
            let extra = self.visits.len() - HISTORY_CAP;
            self.visits.drain(..extra);
        }
        self.dirty = true;
    }
    pub fn set_title(&mut self, url: &str, title: &str) {
        if let Some(v) = self.visits.iter_mut().rev().take(50).find(|v| v.url == url) {
            if v.title != title {
                v.title = title.to_string();
                self.dirty = true;
            }
        }
    }
    pub fn set_favicon(&mut self, url: &str, favicon: &str) {
        if favicon.is_empty() || favicon.starts_with("data:") && favicon.len() > 4096 {
            return;
        }
        if let Some(v) = self.visits.iter_mut().rev().take(30).find(|v| v.url == url) {
            if v.favicon != favicon {
                v.favicon = favicon.to_string();
                self.dirty = true;
            }
        }
    }
    pub fn query(&self, text: &str, before: Option<u64>, limit: usize) -> Vec<Visit> {
        let q = fold(text.trim());
        self.visits
            .iter()
            .rev()
            .filter(|v| before.map_or(true, |b| v.ts < b))
            .filter(|v| q.is_empty() || fold(&v.title).contains(&q) || v.url.to_lowercase().contains(&q))
            .take(limit)
            .cloned()
            .collect()
    }
    /// Pages for the address bar: each page once, scored by how often and how lately it was opened
    /// (every word typed, in any order, with or without marks), more when its site starts with what
    /// is typed, the words start words of its title, or it is a site's front page; a site opened
    /// often that starts with it comes as its front page too.
    pub fn suggest(&self, text: &str, limit: usize) -> Vec<Suggestion> {
        let words: Vec<String> = text.split_whitespace().map(fold).collect();
        if words.is_empty() {
            return vec![];
        }
        let one = if words.len() == 1 {
            let w = words[0].as_str();
            let w = w.find("://").map_or(w, |i| &w[i + 3..]);
            w.strip_prefix("www.").unwrap_or(w).to_string()
        } else {
            String::new()
        };
        struct Hit {
            s: Suggestion,
            score: f64,
            root: bool,
            host: String,
        }
        let now = now_ms();
        let mut by_url: HashMap<&str, Hit> = HashMap::new();
        let mut sites: HashMap<String, (f64, String, bool)> = HashMap::new(); // host -> (score, favicon, http)
        for v in self.visits.iter().rev() {
            let host = host_of(&v.url);
            let site_hit = !one.is_empty() && host.starts_with(&one);
            let s = hay(v);
            let all = words.iter().all(|w| s.contains(w.as_str()));
            if !all && !site_hit {
                continue;
            }
            let age = now.saturating_sub(v.ts) as f64 / 86_400_000.0;
            let w = if age < 1.0 { 100.0 } else if age < 4.0 { 80.0 } else if age < 14.0 { 60.0 } else if age < 31.0 { 40.0 } else if age < 90.0 { 20.0 } else { 10.0 };
            if site_hit {
                let e = sites.entry(host.clone()).or_insert((0.0, String::new(), v.url.starts_with("http:")));
                e.0 += w;
                if e.1.is_empty() && !v.favicon.is_empty() {
                    e.1 = v.favicon.clone();
                }
            }
            if !all {
                continue;
            }
            if let Some(hit) = by_url.get_mut(v.url.as_str()) {
                hit.score += w;
                hit.s.count += 1;
                continue;
            }
            let title = fold(&v.title);
            let mut bonus = 0.0;
            if !one.is_empty() && host.starts_with(&one) {
                bonus += 400.0;
            } else if !one.is_empty() && host.split('.').any(|l| l.starts_with(&one)) {
                bonus += 150.0;
            }
            for word in &words {
                if title.starts_with(word.as_str()) || title.contains(&format!(" {word}")) {
                    bonus += 40.0;
                }
            }
            let path = v.url.find("://").map(|i| &v.url[i + 3..]).and_then(|r| r.find(['/', '?', '#']).map(|j| &r[j..])).unwrap_or("");
            let root = path.is_empty() || path == "/";
            if root {
                bonus += 30.0;
            }
            by_url.insert(&v.url, Hit { s: Suggestion { url: v.url.clone(), title: v.title.clone(), favicon: v.favicon.clone(), count: 1, last: v.ts }, score: w + bonus, root, host });
        }
        let mut out: Vec<Hit> = by_url.into_values().collect();
        // (a site of its own, at its front page, when it is opened often and none of its front pages is there)
        for (host, (score, favicon, http)) in sites {
            if score < 150.0 || out.iter().any(|h| h.root && h.host == host) {
                continue;
            }
            let url = format!("{}://{}/", if http { "http" } else { "https" }, host);
            out.push(Hit { s: Suggestion { url, title: host.clone(), favicon, count: 0, last: 0 }, score: 380.0 + score.min(600.0) / 10.0, root: true, host });
        }
        // (the same score: the one opened last first)
        out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(b.s.last.cmp(&a.s.last)));
        out.truncate(limit);
        out.into_iter().map(|h| h.s).collect()
    }
    /// Lịch sử's list and its sites (see find_in, domains_in)
    pub fn find(&self, f: &Value) -> Value {
        find_in(&self.visits, f)
    }
    pub fn domains(&self, f: &Value) -> Value {
        domains_in(&self.visits, f)
    }
    /// Every visit matching taken out (the words typed, the site, the time span, one page): how many.
    pub fn remove_where(&mut self, f: &Value) -> usize {
        let flt = Filter::from(f);
        let before = self.visits.len();
        self.visits.retain(|v| !flt.ok(v));
        let n = before - self.visits.len();
        if n > 0 {
            self.dirty = true;
        }
        n
    }
    pub fn remove_ids(&mut self, ids: &[String]) -> usize {
        let before = self.visits.len();
        self.visits.retain(|v| !ids.contains(&v.id));
        let n = before - self.visits.len();
        if n > 0 {
            self.dirty = true;
        }
        n
    }
    pub fn touch(&mut self) {
        self.dirty = true;
    }
    pub fn delete_url(&mut self, url: &str) {
        self.visits.retain(|v| v.url != url);
        self.dirty = true;
    }
    pub fn delete_range(&mut self, from: u64, to: u64) {
        self.visits.retain(|v| v.ts < from || v.ts > to);
        self.dirty = true;
    }
    pub fn save_if_dirty(&mut self) {
        if self.dirty {
            self.dirty = false;
            let v = json!({ "visits": self.visits });
            write_json(&self.path, &v);
        }
    }
}

// ---------- where the data lives ----------
/// TyranWeb's data files, the ones copied by an import.
pub const DATA_FILES: [&str; 10] = ["settings.json", "history.json", "bookmarks.json", "downloads.json", "session.json", "window-history.json", "window-state.json", "scan-history.json", "notes.json", "wallpaper-folder.json"];

/// <profile>/data-folder.json: {"dir": the data folder} and / or {"import": a folder to copy in}.
pub fn folder_file(profile: &Path) -> PathBuf {
    profile.join("data-folder.json")
}
pub fn own_folder(profile: &Path) -> PathBuf {
    profile.join("data")
}
pub fn data_folder(profile: &Path) -> PathBuf {
    let cfg = read_json(&folder_file(profile)).unwrap_or(Value::Null);
    match cfg["dir"].as_str().map(PathBuf::from) {
        Some(d) if d.is_dir() => d,
        _ => own_folder(profile),
    }
}

/// TyranWeb's own data folder on this machine, if it has one.
pub fn tyran_folder() -> Option<PathBuf> {
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from)?;
    let user = roaming.join("TyranWeb");
    let dir = read_json(&user.join("data-folder.json")).and_then(|v| v["dir"].as_str().map(PathBuf::from)).filter(|d| d.is_dir()).unwrap_or(user);
    dir.join("settings.json").exists().then_some(dir)
}

/// An import asked for at the last run: the folder's data files copied in (what was there before put
/// aside in before-import-<time>/); its wallpaper folder is not copied but shared: this data folder's
/// wallpaper-folder.json names it, so its pictures and videos are used where they are.
fn run_import(profile: &Path, data: &Path) {
    let file = folder_file(profile);
    let Some(mut cfg) = read_json(&file) else { return };
    let Some(src) = cfg["import"].as_str().map(PathBuf::from) else { return };
    if src.is_dir() && src != data {
        let aside = data.join(format!("before-import-{}", now_ms()));
        let _ = fs::create_dir_all(data);
        for name in DATA_FILES {
            if name == "wallpaper-folder.json" {
                // (written below, naming the folder's wallpapers wherever they are)
                continue;
            }
            let from = src.join(name);
            let from = if from.exists() { from } else { bak(&from) };
            if !from.exists() {
                continue;
            }
            let to = data.join(name);
            if to.exists() {
                let _ = fs::create_dir_all(&aside);
                let _ = fs::rename(&to, aside.join(name));
            }
            let _ = fs::copy(&from, &to);
        }
        // its wallpapers: shared, used in their own folder
        if let Some(walls) = tyran_walls_of(&src) {
            let to = data.join("wallpaper-folder.json");
            if to.exists() {
                let _ = fs::create_dir_all(&aside);
                let _ = fs::rename(&to, aside.join("wallpaper-folder.json"));
            }
            write_json(&to, &json!({ "dir": walls.to_string_lossy() }));
        }
    }
    cfg.as_object_mut().map(|o| o.remove("import"));
    if cfg["dir"].is_string() {
        write_json(&file, &cfg);
    } else {
        let _ = fs::remove_file(&file);
        let _ = fs::remove_file(bak(&file));
    }
}

/// The wallpaper folder of TyranWeb's data folder `tyran_data`: the one it names
/// (wallpaper-folder.json), the one TyranWeb's profile names, else its profile's own wallpapers/.
pub fn tyran_walls_of(tyran_data: &Path) -> Option<PathBuf> {
    tyran_wallpapers(tyran_data).or_else(|| {
        let user = std::env::var_os("APPDATA").map(PathBuf::from)?.join("TyranWeb");
        read_json(&user.join("wallpaper-folder.json"))
            .and_then(|v| v["dir"].as_str().map(PathBuf::from))
            .filter(|d| d.is_dir())
            .or_else(|| Some(user.join("wallpapers")).filter(|d| d.join("index.json").exists() || d.join("images").is_dir()))
    })
}

/// TyranWeb's wallpapers (what its settings' tyran://userdata/ addresses point to).
pub fn tyran_wallpapers(data: &Path) -> Option<PathBuf> {
    let moved = read_json(&data.join("wallpaper-folder.json")).and_then(|v| v["dir"].as_str().map(PathBuf::from)).filter(|d| d.is_dir());
    moved.or_else(|| Some(data.join("wallpapers")).filter(|d| d.is_dir()))
}

/// TyranWeb's settings with one of its own web wallpaper packages chosen ({preset: "package", package:
/// id}, no address): the address of its page, for this browser, which shows web wallpapers by address.
fn fix_tyran_web(s: &mut Value, data: &Path) {
    let web = &s["wallpaper"]["web"];
    let preset = web["preset"].as_str().unwrap_or("");
    if !(preset == "package" || preset == "special") || !web["url"].as_str().unwrap_or("").is_empty() {
        return;
    }
    let Some(id) = web["package"].as_str().filter(|x| !x.is_empty() && !x.contains(['/', '\\', '.'])).map(String::from) else { return };
    let Some(root) = tyran_wallpapers(data) else { return };
    let list = read_json(&root.join("live").join("index.json")).and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let entry = list.iter().find(|w| w["id"] == id.as_str()).and_then(|w| w["entry"].as_str()).unwrap_or("index.html").to_string();
    let page = root.join("live").join(&id).join(&entry);
    if page.exists() {
        s["wallpaper"]["web"]["url"] = json!(crate::wallmore::file_url(&page));
    }
}

/// The browser's own default wallpaper under an earlier name of the browser (mose-, ming-default.jpg):
/// the same picture, now wings-default.jpg - in the wallpaper and in a slideshow's list.
fn fix_old_wallpaper_names(s: &mut Value) {
    let fix = |v: &mut Value| {
        if let Some(u) = v.as_str() {
            for old in ["/assets/wallpapers/mose-default", "/assets/wallpapers/ming-default"] {
                if u.contains(old) {
                    *v = json!(u.replace(old, "/assets/wallpapers/wings-default"));
                    return;
                }
            }
        }
    };
    fix(&mut s["wallpaper"]["image"]);
    if let Some(list) = s["wallpaper"]["slideshow"].as_array_mut() {
        list.iter_mut().for_each(fix);
    }
}

/// This browser's files from before it kept TyranWeb's (sessions.json, scans.json, a plain history
/// list): read once more, then written in the new files and put aside as *.old.
fn migrate_old(data: &Path) -> Option<Value> {
    let old = data.join("sessions.json");
    if data.join("session.json").exists() || !old.exists() {
        return None;
    }
    let v = read_json(&old)?;
    let _ = fs::rename(&old, data.join("sessions.json.old"));
    Some(v)
}

pub struct Store {
    pub dir: PathBuf,
    pub data: PathBuf,
    pub settings: Mutex<Doc>,
    pub bookmarks: Mutex<Doc>,
    pub sessions: Mutex<Doc>,
    pub downloads: Mutex<Doc>,
    pub notes: Mutex<Doc>,
    pub history: Mutex<History>,
    pub engines: Value,
}

impl Store {
    pub fn open(dir: &Path) -> Store {
        let data = data_folder(dir);
        run_import(dir, &data);
        let _ = fs::create_dir_all(&data);
        let settings_default: Value = serde_json::from_str(include_str!("../defaults/settings.json")).unwrap();
        let bookmarks_default: Value = serde_json::from_str(include_str!("../defaults/bookmarks.json")).unwrap();
        let mut bookmarks = Doc::load(data.join("bookmarks.json"), Value::Null);
        if bookmarks.value.is_null() {
            bookmarks.value = bookmarks_default;
            bookmarks.touch();
        }
        let sessions_default = json!({ "windows": {}, "closed": [], "closedWindows": [] });
        let mut sessions = Doc::load_kind(data.join("session.json"), sessions_default.clone(), Kind::Sessions);
        if let Some(old) = migrate_old(&data) {
            let mut v = sessions_default;
            deep_merge(&mut v, &old);
            sessions.value = v;
            sessions.touch();
        }
        let mut settings = Doc::load_kind(data.join("settings.json"), settings_default, Kind::Settings);
        fix_tyran_web(&mut settings.value, &data);
        fix_old_wallpaper_names(&mut settings.value);
        settings.touch();
        let mut downloads = Doc::load_kind(data.join("downloads.json"), json!({ "items": [] }), Kind::Downloads);
        downloads.touch();
        let mut notes = Doc::load(data.join("notes.json"), json!({ "text": "", "updated": 0 }));
        if !data.join("notes.json").exists() {
            notes.touch();
        }
        Store {
            dir: dir.to_path_buf(),
            data: data.clone(),
            settings: Mutex::new(settings),
            bookmarks: Mutex::new(bookmarks),
            sessions: Mutex::new(sessions),
            downloads: Mutex::new(downloads),
            notes: Mutex::new(notes),
            history: Mutex::new(History::load(data.join("history.json"))),
            engines: serde_json::from_str(include_str!("../defaults/engines.json")).unwrap(),
        }
    }
    pub fn save_all(&self) {
        for d in [&self.settings, &self.bookmarks, &self.sessions, &self.downloads, &self.notes] {
            if let Ok(mut d) = d.lock() {
                d.save_if_dirty();
            }
        }
        if let Ok(mut h) = self.history.lock() {
            h.save_if_dirty();
        }
    }
    pub fn settings(&self) -> Value {
        self.settings.lock().unwrap().value.clone()
    }
    pub fn setting_str(&self, path: &[&str]) -> String {
        let s = self.settings.lock().unwrap();
        let mut v = &s.value;
        for p in path {
            v = &v[*p];
        }
        v.as_str().unwrap_or("").to_string()
    }
    pub fn setting_f64(&self, path: &[&str]) -> f64 {
        let s = self.settings.lock().unwrap();
        let mut v = &s.value;
        for p in path {
            v = &v[*p];
        }
        v.as_f64().unwrap_or(0.0)
    }
    pub fn setting_bool(&self, path: &[&str]) -> bool {
        let s = self.settings.lock().unwrap();
        let mut v = &s.value;
        for p in path {
            v = &v[*p];
        }
        v.as_bool().unwrap_or(false)
    }
}

