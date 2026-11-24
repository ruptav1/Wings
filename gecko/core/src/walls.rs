//! Wallpapers kept in the profile (profile/wallpapers): the user's pictures and videos, what is known
//! of each (index.json: title, where it came from, size, length…), small pictures of them (thumbs/),
//! and the places new ones are found:
//! - Wallhaven, searched through its API (pictures; safe for work only, AI art left out);
//! - the video wallpaper store (unk://store): MoeWalls, MotionBGs and WallpaperWaifu. Their pages are
//!   fetched here and read by the store page (pages/store/sources.js); a video picked there is
//!   downloaded here, its progress told to the page;
//! - a link to a picture or a video (a page's context menu, Settings → Hình nền).
//!
//! A file is known by what it holds, not by its name: a video saved as "wallpaper.jpg" is a video.
use crate::{state::App, store::deep_merge};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use crate::tauri::{AppHandle, Emitter, Manager};

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
const VIDEO_MAX: u64 = 4 * 1024 * 1024 * 1024;
const IMAGE_MAX: u64 = 80 * 1024 * 1024;

// ---------- where they are ----------
// TyranWeb's own wallpaper folder, shared, when the data folder names one (wallpaper-folder.json:
// written by "Đồng bộ data từ TyranWeb", or TyranWeb's data folder chosen in Settings): used where it
// is, in its layout — images/ and videos/ (files named local-… / video-…), thumbnails/<file>.thumb.jpg,
// index.json as a list of {file, type, added, title…}, music/, live/ — new ones added there as
// TyranWeb adds them, so either browser sees them. Linked folders' files keep this browser's own notes (unk-index.json, thumbs/).
pub(crate) fn tyran_root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| crate::store::tyran_wallpapers(&crate::state::app().store.data)).clone()
}
pub fn dir(app: &AppHandle) -> PathBuf {
    tyran_root().unwrap_or_else(|| app.state::<App>().profile.join("wallpapers"))
}
pub(crate) fn thumbs_dir(app: &AppHandle) -> PathBuf {
    dir(app).join("thumbs")
}
pub fn url_of(name: &str) -> String {
    if tyran_root().is_some() {
        format!("resource://unktyran/{name}")
    } else {
        format!("resource://unkwall/{name}")
    }
}

/// "images/x.jpg" / "videos/x.mp4" in TyranWeb's folder: (its sub-folder, the file).
fn tyran_name(name: &str) -> Option<(&'static str, String)> {
    tyran_root()?;
    let (sub, rest) = name.split_once(['/', '\\'])?;
    let sub = match sub {
        "images" => "images",
        "videos" => "videos",
        _ => return None,
    };
    Some((sub, crate::protocol_name(rest)))
}
/// A wallpaper's name made safe (in TyranWeb's folder, its one level of sub-folders kept).
pub(crate) fn clean_name(name: &str) -> String {
    match tyran_name(name) {
        Some((sub, f)) => format!("{sub}/{f}"),
        None => crate::protocol_name(name),
    }
}
/// Its small picture, relative to the folder.
pub(crate) fn thumb_rel(name: &str) -> String {
    match tyran_name(name) {
        Some((_, f)) => format!("thumbnails/{f}.thumb.jpg"),
        None => format!("thumbs/{name}.jpg"),
    }
}

/// Where a new picture or video goes, and the name it is known by: this browser's folder (a name
/// from the file's own), or TyranWeb's (images/local-….jpg, videos/video-….mp4, as TyranWeb names them).
pub(crate) fn new_name(app: &AppHandle, kind: &str, stem: &str, ext: &str) -> (PathBuf, String) {
    let d = dir(app);
    if tyran_root().is_some() {
        let (sub, pre) = if kind == "video" { ("videos", "video-") } else { ("images", "local-") };
        let _ = fs::create_dir_all(d.join(sub));
        loop {
            let f = format!("{}.{ext}", crate::store::uid(pre));
            if !d.join(sub).join(&f).exists() {
                return (d.join(sub).join(&f), format!("{sub}/{f}"));
            }
        }
    }
    let _ = fs::create_dir_all(&d);
    let f = unique(&d, stem, ext);
    (d.join(&f), f)
}

/// What a file holds, from its first bytes: ("image" | "video", its usual extension).
pub fn sniff(head: &[u8]) -> Option<(&'static str, &'static str)> {
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return Some(match &head[8..12] {
            b"avif" | b"avis" => ("image", "avif"),
            b"qt  " => ("video", "mov"),
            _ => ("video", "mp4"),
        });
    }
    if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(("video", "webm"));
    }
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(("image", "jpg"));
    }
    if head.starts_with(b"\x89PNG") {
        return Some(("image", "png"));
    }
    if head.starts_with(b"GIF8") {
        return Some(("image", "gif"));
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Some(("image", "webp"));
    }
    if head.starts_with(b"BM") {
        return Some(("image", "bmp"));
    }
    None
}

pub fn sniff_file(p: &Path) -> Option<(&'static str, &'static str)> {
    let mut f = File::open(p).ok()?;
    let mut b = [0u8; 16];
    let n = f.read(&mut b).ok()?;
    sniff(&b[..n])
}

pub(crate) fn kind_by_name(name: &str) -> Option<&'static str> {
    let ext = name.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp" => Some("image"),
        "mp4" | "m4v" | "webm" | "mov" => Some("video"),
        _ => None,
    }
}

/// A file name not yet used in the folder: `stem.ext`, `stem-2.ext`…
pub(crate) fn unique(dir: &Path, stem: &str, ext: &str) -> String {
    let stem = crate::protocol_name(stem);
    let stem: String = stem.chars().take(60).collect();
    let mut name = format!("{stem}.{ext}");
    let mut i = 2;
    while dir.join(&name).exists() {
        name = format!("{stem}-{i}.{ext}");
        i += 1;
    }
    name
}

// ---------- what is known of each ----------
static INDEX: Mutex<()> = Mutex::new(());

// (this browser's notes: index.json in its own folder; unk-index.json beside TyranWeb's list)
fn own_index_file(app: &AppHandle) -> PathBuf {
    dir(app).join(if tyran_root().is_some() { "unk-index.json" } else { "index.json" })
}
fn own_index(app: &AppHandle) -> Map<String, Value> {
    fs::read_to_string(own_index_file(app)).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default()
}
fn tyran_list(app: &AppHandle) -> Vec<Value> {
    fs::read_to_string(dir(app).join("index.json")).ok().and_then(|s| serde_json::from_str::<Vec<Value>>(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default()
}
fn tyran_list_write(app: &AppHandle, list: &[Value]) {
    let _ = fs::write(dir(app).join("index.json"), serde_json::to_vec_pretty(list).unwrap_or_default());
}
fn tyran_type(sub: &str) -> &'static str {
    if sub == "videos" {
        "video"
    } else {
        "image"
    }
}

pub(crate) fn index_read(app: &AppHandle) -> Map<String, Value> {
    let mut m = own_index(app);
    if tyran_root().is_some() {
        for e in tyran_list(app) {
            if let Some(f) = e["file"].as_str() {
                let sub = if e["type"] == "video" { "videos" } else { "images" };
                m.insert(format!("{sub}/{f}"), e.clone());
            }
        }
    }
    m
}

fn index_write(app: &AppHandle, m: &Map<String, Value>) {
    let _ = fs::create_dir_all(dir(app));
    let _ = fs::write(own_index_file(app), serde_json::to_vec_pretty(m).unwrap_or_default());
}

pub(crate) fn index_update(app: &AppHandle, name: &str, patch: Value) {
    let _g = INDEX.lock().unwrap();
    if let Some((sub, f)) = tyran_name(name) {
        let mut list = tyran_list(app);
        let ty = tyran_type(sub);
        match list.iter_mut().find(|e| e["file"] == f.as_str() && e["type"].as_str().unwrap_or("image") == ty) {
            Some(e) => deep_merge(e, &patch),
            None => {
                let mut e = json!({ "file": f, "added": crate::store::now_ms(), "type": ty });
                deep_merge(&mut e, &patch);
                list.insert(0, e);
            }
        }
        tyran_list_write(app, &list);
        return;
    }
    let mut m = own_index(app);
    let e = m.entry(name.to_string()).or_insert_with(|| json!({}));
    deep_merge(e, &patch);
    index_write(app, &m);
}

fn index_remove(app: &AppHandle, name: &str) {
    let _g = INDEX.lock().unwrap();
    if let Some((sub, f)) = tyran_name(name) {
        let mut list = tyran_list(app);
        let n = list.len();
        list.retain(|e| !(e["file"] == f.as_str() && e["type"].as_str().unwrap_or("image") == tyran_type(sub)));
        if list.len() != n {
            tyran_list_write(app, &list);
        }
        return;
    }
    let mut m = own_index(app);
    if m.remove(name).is_some() {
        index_write(app, &m);
    }
}

pub(crate) fn entry(app: &AppHandle, name: &str, meta: Option<&Value>) -> Value {
    let path = dir(app).join(name);
    let kind = sniff_file(&path).map(|k| k.0).or_else(|| kind_by_name(name)).unwrap_or("image");
    let md = fs::metadata(&path).ok();
    let thumb = dir(app).join(thumb_rel(name));
    let mut e = json!({
        "name": name,
        "url": url_of(name),
        "kind": kind,
        "size": md.as_ref().map(|m| m.len()).unwrap_or(0),
        "added": md.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
        "thumb": if thumb.exists() { url_of(&thumb_rel(name)) } else { String::new() },
    });
    if let Some(m) = meta {
        deep_merge(&mut e, m);
    }
    e
}

/// Puts a wallpaper in place (every window follows the settings).
pub fn use_wallpaper(app: &AppHandle, patch: Value) {
    let s = {
        let st = app.state::<App>();
        let mut doc = st.store.settings.lock().unwrap();
        deep_merge(&mut doc.value, &json!({ "wallpaper": patch }));
        doc.touch();
        doc.value.clone()
    };
    let _ = app.emit("settings", s);
}

pub(crate) fn changed(app: &AppHandle) {
    let _ = app.emit("wallpapers-changed", json!({}));
}

// ---------- the user's files ----------
pub fn wallpaper_list(app: AppHandle) -> Value {
    let meta = index_read(&app);
    let mut out = vec![];
    let folders: Vec<(PathBuf, &str)> = if tyran_root().is_some() { vec![(dir(&app).join("images"), "images/"), (dir(&app).join("videos"), "videos/")] } else { vec![(dir(&app), "")] };
    for (folder, prefix) in folders {
        let Ok(rd) = fs::read_dir(&folder) else { continue };
        for e in rd.flatten() {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".json") || n.ends_with(".part") || n.ends_with(".tmp") {
                continue;
            }
            let path = e.path();
            if sniff_file(&path).is_none() && kind_by_name(&n).is_none() {
                continue;
            }
            let name = format!("{prefix}{n}");
            out.push(entry(&app, &name, meta.get(&name)));
        }
    }
    // (and the linked folders', read where they are)
    out.extend(crate::wallmore::linked_entries());
    // newest first
    out.sort_by(|a, b| b["added"].as_u64().cmp(&a["added"].as_u64()));
    json!(out)
}

/// A picture or a video from the user's computer (its bytes, its name in the x-name header).
pub fn wallpaper_save(app: AppHandle, request: crate::tauri::ipc::Request<'_>) -> R<Value> {
    let crate::tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected file bytes".into()) };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("wallpaper");
    let name = urlish_decode(name);
    let Some((kind, ext)) = sniff(&bytes[..bytes.len().min(16)]) else { return Err("Không phải ảnh hoặc video".into()) };
    let stem = Path::new(&name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "wallpaper".into());
    let (path, file) = new_name(&app, kind, &stem, ext);
    fs::write(&path, bytes).map_err(err)?;
    index_update(&app, &file, json!({ "title": stem }));
    changed(&app);
    Ok(entry(&app, &file, Some(&json!({ "title": stem }))))
}

fn urlish_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

pub fn wallpaper_delete(app: AppHandle, name: String) {
    let name = clean_name(&name);
    let _ = fs::remove_file(dir(&app).join(&name));
    let _ = fs::remove_file(dir(&app).join(thumb_rel(&name)));
    index_remove(&app, &name);
    changed(&app);
}

/// What the page read from a file itself (a video's size in pixels and its length) or a new title.
pub fn wallpaper_meta(app: AppHandle, name: String, patch: Value) -> Value {
    let name = clean_name(&name);
    let mut clean = Map::new();
    for k in ["width", "height", "duration"] {
        if let Some(n) = patch[k].as_f64().filter(|n| n.is_finite() && *n > 0.0) {
            clean.insert(k.into(), if k == "duration" { json!((n * 10.0).round() / 10.0) } else { json!(n.round() as u64) });
        }
    }
    if let Some(t) = patch["title"].as_str() {
        clean.insert("title".into(), json!(t.chars().take(200).collect::<String>()));
    }
    index_update(&app, &name, Value::Object(clean));
    entry(&app, &name, index_read(&app).get(&name))
}

/// A small picture of a wallpaper, drawn by the settings page (bytes; its file in x-name).
pub fn wallpaper_thumb(app: AppHandle, request: crate::tauri::ipc::Request<'_>) -> R<String> {
    let crate::tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected bytes".into()) };
    let name = clean_name(&urlish_decode(request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("")));
    if bytes.len() > 4 * 1024 * 1024 || !dir(&app).join(&name).exists() {
        return Err("no such wallpaper".into());
    }
    let thumb = dir(&app).join(thumb_rel(&name));
    if let Some(parent) = thumb.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(&thumb, bytes).map_err(err)?;
    Ok(url_of(&thumb_rel(&name)))
}

// ---------- downloading ----------
fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(60)).redirects(8).user_agent(UA).build()
}

fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static J: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    J.get_or_init(Default::default)
}

/// Downloads `url` into the wallpapers as a file of `want` kind ("image" / "video"); the progress is
/// told as `store-progress` { id, got, total } when an id is given. Returns the new file's name.
fn fetch_into(app: &AppHandle, url: &str, referer: Option<&str>, want: &str, stem: &str, id: Option<&str>) -> R<(String, u64)> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Địa chỉ không hợp lệ".into());
    }
    let max = if want == "video" { VIDEO_MAX } else { IMAGE_MAX };
    let mut req = agent().get(url);
    if let Some(r) = referer {
        req = req.set("Referer", r);
    }
    let resp = req.call().map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("HTTP {code}"),
        e => e.to_string(),
    })?;
    let ct = resp.header("Content-Type").unwrap_or("").to_lowercase();
    // (a page instead of the file: the site no longer has it)
    if ct.contains("text/html") || resp.get_url().contains("/error-file") {
        return Err("gone".into());
    }
    let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if total > max {
        return Err("too big".into());
    }
    let d = dir(app);
    fs::create_dir_all(&d).map_err(err)?;
    let part = d.join(format!("dl-{}.part", crate::store::now_ms()));
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(id) = id {
        jobs().lock().unwrap().insert(id.to_string(), cancel.clone());
    }
    let result = (|| -> R<(String, u64)> {
        let mut out = File::create(&part).map_err(err)?;
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; 64 * 1024];
        let mut head: Vec<u8> = vec![];
        let mut got: u64 = 0;
        let mut told = Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("aborted".into());
            }
            let n = reader.read(&mut buf).map_err(err)?;
            if n == 0 {
                break;
            }
            if head.len() < 16 {
                head.extend_from_slice(&buf[..n.min(16 - head.len())]);
            }
            got += n as u64;
            if got > max {
                return Err("too big".into());
            }
            out.write_all(&buf[..n]).map_err(err)?;
            if let Some(id) = id {
                if told.elapsed() > Duration::from_millis(200) {
                    told = Instant::now();
                    let _ = app.emit("store-progress", json!({ "id": id, "got": got, "total": total }));
                }
            }
        }
        out.flush().map_err(err)?;
        drop(out);
        let Some((kind, ext)) = sniff(&head) else { return Err(if want == "video" { "not a video".into() } else { "not a picture".into() }) };
        if kind != want {
            return Err(if want == "video" { "not a video".into() } else { "not a picture".into() });
        }
        let (path, name) = new_name(app, kind, stem, ext);
        fs::rename(&part, &path).map_err(err)?;
        if let Some(id) = id {
            let _ = app.emit("store-progress", json!({ "id": id, "got": got, "total": got }));
        }
        Ok((name, got))
    })();
    if let Some(id) = id {
        jobs().lock().unwrap().remove(id);
    }
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

/// A small picture from the web as a wallpaper's thumbnail (the site's own picture of a video).
fn fetch_thumb(app: &AppHandle, name: &str, url: &str, referer: Option<&str>) {
    if !url.starts_with("https://") {
        return;
    }
    let mut req = agent().get(url);
    if let Some(r) = referer {
        req = req.set("Referer", r);
    }
    let Ok(resp) = req.call() else { return };
    if !resp.header("Content-Type").unwrap_or("").starts_with("image/") {
        return;
    }
    let mut b = vec![];
    if resp.into_reader().take(8 * 1024 * 1024).read_to_end(&mut b).is_err() || b.len() < 200 {
        return;
    }
    let thumb = dir(app).join(thumb_rel(name));
    if let Some(parent) = thumb.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&thumb, b);
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    crate::tauri::spawn_blocking(f).await.map_err(err)?
}

/// A picture from a page (its context menu) kept as a wallpaper and put in place.
pub async fn wallpaper_from_url(app: AppHandle, url: String, page: Option<String>) -> R<String> {
    blocking(move || {
        let stem = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("").rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_default();
        let stem = if stem.len() < 2 { format!("web-{}", crate::store::now_ms()) } else { stem };
        let (name, _) = fetch_into(&app, &url, page.as_deref(), "image", &stem, None).map_err(|e| if e == "not a picture" { "Đây không phải ảnh".to_string() } else { e })?;
        index_update(&app, &name, json!({ "title": stem, "source": crate::urls::host_of(page.as_deref().unwrap_or(&url)), "page": page.unwrap_or_default() }));
        use_wallpaper(&app, json!({ "type": "image", "image": url_of(&name) }));
        changed(&app);
        Ok(url_of(&name))
    })
    .await
}

/// A video from a link (an .mp4 / .webm file) kept as a wallpaper; progress under `id`.
pub async fn wallpaper_video_url(app: AppHandle, url: String, id: String) -> R<Value> {
    blocking(move || {
        let stem = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("").rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| "video".into());
        let (name, bytes) = fetch_into(&app, &url, None, "video", &stem, Some(&id))?;
        let meta = json!({ "title": stem, "source": crate::urls::host_of(&url), "bytes": bytes });
        index_update(&app, &name, meta.clone());
        changed(&app);
        Ok(entry(&app, &name, Some(&meta)))
    })
    .await
}

/// The Windows desktop's own picture as the wallpaper: the copy Windows keeps of it
/// (%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper), else the file the registry names.
pub async fn wallpaper_desktop(app: AppHandle) -> R<Value> {
    blocking(move || {
        let kept = std::env::var("APPDATA").map(|a| PathBuf::from(a).join("Microsoft").join("Windows").join("Themes").join("TranscodedWallpaper")).ok();
        let src = kept.filter(|p| p.exists()).or_else(|| {
            use std::os::windows::process::CommandExt;
            let out = std::process::Command::new("reg").args(["query", r"HKCU\Control Panel\Desktop", "/v", "WallPaper"]).creation_flags(0x0800_0000).output().ok()?;
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            let line = text.lines().find(|l| l.contains("REG_SZ"))?;
            let p = PathBuf::from(line.split("REG_SZ").nth(1)?.trim());
            p.exists().then_some(p)
        });
        let Some(src) = src else { return Err("Không tìm thấy hình nền desktop".into()) };
        let bytes = fs::read(&src).map_err(err)?;
        let Some(("image", ext)) = sniff(&bytes[..bytes.len().min(16)]) else { return Err("Hình nền desktop không phải ảnh".into()) };
        let prefix = if tyran_root().is_some() { "images/" } else { "" };
        let d = dir(&app).join(prefix);
        fs::create_dir_all(&d).map_err(err)?;
        // (one copy, replaced when Windows' picture changes)
        if let Ok(rd) = fs::read_dir(&d) {
            for e in rd.flatten() {
                let n = format!("{prefix}{}", e.file_name().to_string_lossy());
                if e.file_name().to_string_lossy().starts_with("desktop-wallpaper.") {
                    let _ = fs::remove_file(e.path());
                    let _ = fs::remove_file(dir(&app).join(thumb_rel(&n)));
                    index_remove(&app, &n);
                }
            }
        }
        let name = format!("{prefix}desktop-wallpaper.{ext}");
        fs::write(dir(&app).join(&name), &bytes).map_err(err)?;
        let meta = json!({ "title": "Hình nền desktop", "source": "Windows" });
        index_update(&app, &name, meta.clone());
        // (a new address each time, so every window shows the new picture rather than its cached one)
        let url = format!("{}?v={}", url_of(&name), crate::store::now_ms());
        use_wallpaper(&app, json!({ "type": "image", "image": url }));
        changed(&app);
        Ok(entry(&app, &name, Some(&meta)))
    })
    .await
}

// ---------- Wallhaven ----------
const AI_CUTOFF: &str = "2022-08-01";
const BAD_TAGS: [&str; 8] = ["waifu2x", "upscal", "ai art", "ai generated", "ai-generated", "stable diffusion", "novelai", "midjourney"];

fn get_json(url: &str) -> R<Value> {
    let s = agent()
        .get(url)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(429, _) => "Wallhaven đang bận, thử lại sau ít giây".to_string(),
            ureq::Error::Status(code, _) => format!("HTTP {code}"),
            e => e.to_string(),
        })?
        .into_string()
        .map_err(err)?;
    serde_json::from_str(&s).map_err(err)
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

pub async fn wall_search(query: String, page: Option<u32>, resolution: Option<String>, sorting: Option<String>, category: Option<String>, pre_ai: Option<bool>) -> R<Value> {
    blocking(move || {
        let atleast = match resolution.as_deref() {
            Some("1080p") => "1920x1080",
            Some("1440p") => "2560x1440",
            Some("4k") => "3840x2160",
            _ => "1920x1080",
        };
        let sorting = match sorting.as_deref() {
            Some(s @ ("favorites" | "toplist" | "views" | "date_added" | "relevance" | "random")) => s,
            _ => "favorites",
        };
        let categories = match category.as_deref() {
            Some("general") => "100",
            Some("all") => "110",
            _ => "010",
        };
        let pre_ai = pre_ai.unwrap_or(false);
        // (the "before AI" filter can empty most of a page: up to 4 pages are read for enough to show)
        let mut found: Vec<Value> = vec![];
        let mut current = page.unwrap_or(1).max(1);
        let mut last = current;
        let mut total = 0u64;
        for _ in 0..4 {
            let url = format!(
                "https://wallhaven.cc/api/v1/search?q={}&categories={categories}&purity=100&sorting={sorting}&order=desc&atleast={atleast}&ratios=landscape&ai_art_filter=1&page={current}",
                enc(query.trim())
            );
            let j = get_json(&url)?;
            last = j["meta"]["last_page"].as_u64().unwrap_or(current as u64) as u32;
            total = j["meta"]["total"].as_u64().unwrap_or(0);
            for w in j["data"].as_array().cloned().unwrap_or_default() {
                let created = w["created_at"].as_str().unwrap_or("9999");
                if pre_ai && created >= AI_CUTOFF {
                    continue;
                }
                found.push(json!({
                    "id": w["id"],
                    "page": w["url"],
                    "thumb": w["thumbs"]["small"],
                    "large": w["thumbs"]["large"],
                    "resolution": w["resolution"],
                    "width": w["dimension_x"],
                    "height": w["dimension_y"],
                    "size": w["file_size"],
                    "favorites": w["favorites"],
                    "uploaded": created.get(..10).unwrap_or(""),
                    "source": w["source"],
                    "colors": w["colors"],
                }));
            }
            if found.len() >= 12 || current >= last {
                break;
            }
            current += 1;
        }
        Ok(json!({ "items": found, "page": current, "lastPage": last, "total": total }))
    })
    .await
}

/// A Wallhaven picture downloaded (its record read again for the file's trusted address and its tags).
pub async fn wall_get(app: AppHandle, id: String, apply: Option<bool>) -> R<Value> {
    blocking(move || {
        let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        if id.is_empty() {
            return Err("URL không hợp lệ".into());
        }
        let stem = format!("wallhaven-{id}");
        // (already here: used again)
        let have = wallpaper_list(app.clone()).as_array().cloned().unwrap_or_default().into_iter().find(|e| e["name"].as_str().is_some_and(|n| n.starts_with(&format!("{stem}."))));
        let e = if let Some(e) = have {
            e
        } else {
            let info = get_json(&format!("https://wallhaven.cc/api/v1/w/{id}"))?["data"].clone();
            let path = info["path"].as_str().unwrap_or("");
            if !path.starts_with("https://w.wallhaven.cc/") {
                return Err("URL không hợp lệ".into());
            }
            for t in info["tags"].as_array().cloned().unwrap_or_default() {
                let n = t["name"].as_str().unwrap_or("").to_lowercase();
                if BAD_TAGS.iter().any(|b| n.contains(b)) {
                    return Err(format!("Ảnh bị gắn thẻ \"{n}\" nên đã bỏ qua"));
                }
            }
            let (name, bytes) = fetch_into(&app, path, Some("https://wallhaven.cc/"), "image", &stem, None)?;
            if let Some(t) = info["thumbs"]["large"].as_str() {
                fetch_thumb(&app, &name, t, None);
            }
            let meta = json!({
                "title": format!("Wallhaven {id}"),
                "source": "Wallhaven",
                "page": info["url"],
                "origin": info["source"],
                "width": info["dimension_x"],
                "height": info["dimension_y"],
                "bytes": bytes,
            });
            index_update(&app, &name, meta.clone());
            changed(&app);
            entry(&app, &name, Some(&meta))
        };
        if apply.unwrap_or(true) {
            use_wallpaper(&app, json!({ "type": "image", "image": e["url"] }));
        }
        Ok(e)
    })
    .await
}

// ---------- the video wallpaper store ----------
// each site: the pages that may be read, the hosts its videos come from
const SITES: [(&str, &str, &[&str], &[&str]); 3] = [
    ("moewalls", "MoeWalls", &["moewalls.com"], &["go.moewalls.com"]),
    ("motionbgs", "MotionBGs", &["motionbgs.com"], &["motionbgs.com"]),
    ("wallpaperwaifu", "WallpaperWaifu", &["wallpaperwaifu.com"], &["go.wallpaperwaifu.com"]),
];

fn host_in(url: &str, hosts: &[&str]) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#', ':']).next().unwrap_or("").to_lowercase();
    hosts.iter().any(|h| host == *h || host == format!("www.{h}"))
}

/// A page of a store site, as HTML for the store page to read.
pub async fn store_page(url: String) -> R<Value> {
    blocking(move || {
        if !SITES.iter().any(|s| host_in(&url, s.2)) {
            return Err("not a store site".into());
        }
        let resp = agent().get(&url).set("Accept", "text/html,application/xhtml+xml").set("Accept-Language", "en").call().map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("HTTP {code}"),
            e => e.to_string(),
        })?;
        let final_url = resp.get_url().to_string();
        let mut html = String::new();
        resp.into_reader().take(6 * 1024 * 1024).read_to_string(&mut html).map_err(err)?;
        let head = &html[..html.len().min(6000)];
        if head.contains("Just a moment") || head.contains("cf_chl_opt") || head.contains("You are being redirected") {
            return Err("gate".into());
        }
        Ok(json!({ "url": final_url, "html": html }))
    })
    .await
}

pub async fn store_download(app: AppHandle, item: Value) -> R<Value> {
    blocking(move || {
        let s = |k: &str| item[k].as_str().unwrap_or("").to_string();
        let (id, site_id, page, file) = (s("id"), s("site"), s("page"), s("file"));
        let Some(site) = SITES.iter().find(|x| x.0 == site_id) else { return Err("not a store video".into()) };
        if id.is_empty() || !host_in(&file, site.3) || !host_in(&page, site.2) {
            return Err("not a store video".into());
        }
        let title: String = s("title").chars().take(200).collect();
        let stem = if title.is_empty() { format!("video-{}", crate::store::now_ms()) } else { title.clone() };
        let (name, bytes) = fetch_into(&app, &file, Some(&page), "video", &stem, Some(&id))?;
        let thumb = s("thumb");
        if host_in(&thumb, site.2) {
            fetch_thumb(&app, &name, &thumb, Some(&page));
        }
        let num = |k: &str| item[k].as_f64().filter(|n| n.is_finite() && *n > 0.0).map(|n| n.round() as u64).unwrap_or(0);
        let meta = json!({
            "title": if title.is_empty() { site.1.to_string() } else { title },
            "source": site.1,
            "site": site.0,
            "page": page,
            "bytes": bytes,
            "width": num("width"),
            "height": num("height"),
            "date": s("date").chars().take(10).collect::<String>(),
            "tags": item["tags"].as_array().map(|a| a.iter().take(30).cloned().collect::<Vec<_>>()).unwrap_or_default(),
            "origin": s("origin").chars().take(100).collect::<String>(),
        });
        index_update(&app, &name, meta.clone());
        changed(&app);
        Ok(entry(&app, &name, Some(&meta)))
    })
    .await
}

pub fn store_cancel(id: String) {
    if let Some(c) = jobs().lock().unwrap().get(&id) {
        c.store(true, Ordering::Relaxed);
    }
}
