//! More of the wallpapers (from TyranWeb):
//! - many pictures / videos added at once (files, a whole folder, a zip), and folders linked to be
//!   used in place (linked.json: their files are listed as wallpapers, read where they are);
//! - a wallpaper's own music: audio files (copied into wallpapers/music) or a YouTube / SoundCloud /
//!   Spotify link (played in its embed player);
//! - web wallpapers: a page, or a package (a folder or a zip with an index.html: Wallpaper Engine's
//!   and Lively's web wallpapers) kept in wallpapers/live/<id>, and Specials: web wallpapers found on
//!   GitHub (repositories tagged wallpaper-engine / lively-wallpaper / live-wallpaper) and installed
//!   from GitHub's zip of them.
use crate::state::App;
use crate::store::now_ms;
use crate::tauri::{AppHandle, Emitter, Manager};
use crate::walls;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

type R<T> = Result<T, String>;
const UA: &str = "Wings";
const MEDIA_MAX: u64 = 4 * 1024 * 1024 * 1024;

fn walls_dir() -> PathBuf {
    walls::dir(&AppHandle)
}

/// A file URL the interface can load (the browser's own pages and its window read files directly).
pub fn file_url(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let enc: String = s
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '/' | ':' | '-' | '_' | '.' | '~' => c.to_string(),
            c => {
                let mut b = [0u8; 4];
                c.encode_utf8(&mut b).bytes().map(|x| format!("%{x:02X}")).collect()
            }
        })
        .collect();
    format!("file:///{enc}")
}

// ---------------------------------------------------------------- many at once
fn media_kind(p: &Path) -> Option<(&'static str, &'static str)> {
    walls::sniff_file(p).or_else(|| {
        let n = p.file_name()?.to_string_lossy().to_string();
        let k = walls::kind_by_name(&n)?;
        Some((k, if k == "image" { "jpg" } else { "mp4" }))
    })
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth < 3 {
                walk(&p, depth + 1, out);
            }
        } else {
            out.push(p);
        }
        if out.len() > 2000 {
            return;
        }
    }
}

fn add_one(src: &Path, bytes: Option<&[u8]>, name: &str, added: &mut Vec<Value>, skipped: &mut u32) {
    let kind = match bytes {
        Some(b) => walls::sniff(&b[..b.len().min(16)]),
        None => media_kind(src),
    };
    let Some((kind, ext)) = kind else { return };
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "wallpaper".into());
    // (TyranWeb's folder: its images/ or videos/, its files named by TyranWeb, not after theirs)
    let tyran = walls::tyran_root().is_some();
    let d = if tyran { walls_dir().join(if kind == "video" { "videos" } else { "images" }) } else { walls_dir() };
    let _ = fs::create_dir_all(&d);
    // (the same file already there: not added twice)
    let size = bytes.map(|b| b.len() as u64).or_else(|| fs::metadata(src).ok().map(|m| m.len())).unwrap_or(0);
    let clean = crate::protocol_name(&stem);
    if fs::read_dir(&d).ok().into_iter().flatten().flatten().any(|e| (tyran || e.file_name().to_string_lossy().starts_with(&clean)) && e.metadata().map(|m| m.len()).unwrap_or(0) == size) {
        *skipped += 1;
        return;
    }
    if size == 0 || size > MEDIA_MAX {
        return;
    }
    let (path, file) = walls::new_name(&AppHandle, kind, &stem, ext);
    let ok = match bytes {
        Some(b) => fs::write(&path, b).is_ok(),
        None => fs::copy(src, &path).is_ok(),
    };
    if ok {
        walls::index_update(&AppHandle, &file, json!({ "title": stem }));
        added.push(walls::entry(&AppHandle, &file, Some(&json!({ "title": stem }))));
    }
}

/// Pictures and videos among `paths` (files, folders: what they hold, zips: their media) copied in.
pub fn add_paths(paths: Vec<String>) -> Value {
    let mut added = vec![];
    let mut skipped = 0u32;
    for p in paths {
        let p = PathBuf::from(p);
        if p.is_dir() {
            let mut files = vec![];
            walk(&p, 0, &mut files);
            for f in files {
                let n = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                add_one(&f, None, &n, &mut added, &mut skipped);
            }
        } else if p.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false) {
            let Ok(f) = fs::File::open(&p) else { continue };
            let Ok(mut z) = zip::ZipArchive::new(f) else { continue };
            for i in 0..z.len() {
                let Ok(mut e) = z.by_index(i) else { continue };
                if e.is_dir() || e.size() > MEDIA_MAX {
                    continue;
                }
                let name = Path::new(e.name()).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if walls::kind_by_name(&name).is_none() {
                    continue;
                }
                let mut buf = Vec::with_capacity(e.size() as usize);
                if e.read_to_end(&mut buf).is_ok() {
                    add_one(&p, Some(&buf), &name, &mut added, &mut skipped);
                }
            }
        } else {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            add_one(&p, None, &n, &mut added, &mut skipped);
        }
    }
    if !added.is_empty() {
        walls::changed(&AppHandle);
    }
    json!({ "added": added, "skipped": skipped })
}

// ---------------------------------------------------------------- folders used in place
fn linked_path() -> PathBuf {
    walls_dir().join("linked.json")
}
fn linked() -> Vec<Value> {
    fs::read(linked_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn linked_write(v: &[Value]) {
    let _ = fs::create_dir_all(walls_dir());
    let _ = fs::write(linked_path(), serde_json::to_vec_pretty(v).unwrap_or_default());
}

pub fn link_folder(path: &str) -> R<Value> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err("Không phải thư mục".into());
    }
    let mut list = linked();
    if list.iter().any(|f| f["path"].as_str().map(|x| x.eq_ignore_ascii_case(path)).unwrap_or(false)) {
        return Ok(Value::Null);
    }
    let id = format!("f{}", now_ms() % 1_000_000_000);
    let title = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
    let e = json!({ "id": id, "path": path, "title": title });
    list.push(e.clone());
    linked_write(&list);
    walls::changed(&AppHandle);
    Ok(e)
}

pub fn unlink_folder(id: &str) {
    let list: Vec<Value> = linked().into_iter().filter(|f| f["id"] != id).collect();
    linked_write(&list);
    walls::changed(&AppHandle);
}

/// The linked folders with how many wallpapers each holds.
pub fn folders() -> Value {
    json!(linked()
        .into_iter()
        .map(|f| {
            let p = PathBuf::from(f["path"].as_str().unwrap_or(""));
            let mut files = vec![];
            if p.is_dir() {
                walk(&p, 0, &mut files);
            }
            let count = files.iter().filter(|x| x.file_name().map(|n| walls::kind_by_name(&n.to_string_lossy()).is_some()).unwrap_or(false)).count();
            json!({ "id": f["id"], "path": f["path"], "title": f["title"], "count": count, "missing": !p.is_dir() })
        })
        .collect::<Vec<_>>())
}

/// The wallpapers of the linked folders (read where they are: file URLs).
pub fn linked_entries() -> Vec<Value> {
    let meta = walls::index_read(&AppHandle);
    let thumbs = walls::thumbs_dir(&AppHandle);
    let mut out = vec![];
    for f in linked() {
        let root = PathBuf::from(f["path"].as_str().unwrap_or(""));
        let id = f["id"].as_str().unwrap_or("");
        let mut files = vec![];
        walk(&root, 0, &mut files);
        for p in files {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let Some(kind) = walls::kind_by_name(&n) else { continue };
            let rel = p.strip_prefix(&root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| n.clone());
            let name = crate::protocol_name(&format!("{id}-{rel}"));
            let md = fs::metadata(&p).ok();
            let thumb = thumbs.join(format!("{name}.jpg"));
            let mut e = json!({
                "name": name, "url": file_url(&p), "kind": kind, "linked": id, "folder": f["title"],
                "title": Path::new(&n).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                "size": md.as_ref().map(|m| m.len()).unwrap_or(0),
                "added": md.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
                "thumb": if thumb.exists() { walls::url_of(&format!("thumbs/{name}.jpg")) } else { String::new() },
            });
            if let Some(m) = meta.get(&name) {
                crate::store::deep_merge(&mut e, m);
            }
            out.push(e);
        }
    }
    out
}

// ---------------------------------------------------------------- a wallpaper's own music
const AUDIO: &[&str] = &["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a", "aac", "weba"];

/// Audio files copied into wallpapers/music: [{ file, title, url }]
pub fn music_add(paths: Vec<String>) -> Value {
    let d = walls_dir().join("music");
    let _ = fs::create_dir_all(&d);
    let mut out = vec![];
    for p in paths {
        let p = PathBuf::from(p);
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !AUDIO.contains(&ext.as_str()) || fs::metadata(&p).map(|m| m.len() > 300 * 1024 * 1024).unwrap_or(true) {
            continue;
        }
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "music".into());
        let file = walls::unique(&d, &stem, &ext);
        if fs::copy(&p, d.join(&file)).is_ok() {
            out.push(json!({ "file": file, "title": stem, "url": walls::url_of(&format!("music/{file}")) }));
        }
    }
    json!(out)
}

fn query_of(url: &str, key: &str) -> Option<String> {
    url.split(['?', '&', '#']).skip(1).find_map(|kv| kv.strip_prefix(&format!("{key}=")).map(|v| v.to_string())).filter(|v| !v.is_empty())
}

fn oembed(endpoint: &str, url: &str) -> String {
    let enc: String = url.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
    ureq::get(&format!("{endpoint}{enc}"))
        .timeout(Duration::from_secs(10))
        .set("User-Agent", UA)
        .call()
        .ok()
        .and_then(|r| r.into_string().ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["title"].as_str().map(String::from))
        .unwrap_or_default()
}

/// A YouTube / SoundCloud / Spotify link made into the music of a wallpaper: { kind, url, embed, title }
pub fn music_link(url: &str) -> R<Value> {
    let u = url.trim();
    let low = u.to_lowercase();
    if low.contains("youtube.com/") || low.contains("youtu.be/") {
        let video = query_of(u, "v").or_else(|| low.contains("youtu.be/").then(|| u.split("youtu.be/").nth(1).unwrap_or("").split(['?', '&', '/']).next().unwrap_or("").to_string())).filter(|v| v.len() == 11);
        let list = query_of(u, "list");
        if video.is_none() && list.is_none() {
            return Err("Link YouTube cần có video hoặc danh sách phát".into());
        }
        let embed = match (&video, &list) {
            (Some(v), Some(l)) => format!("https://www.youtube.com/embed/{v}?autoplay=1&list={l}&loop=1"),
            (Some(v), None) => format!("https://www.youtube.com/embed/{v}?autoplay=1&loop=1&playlist={v}"),
            (None, Some(l)) => format!("https://www.youtube.com/embed/videoseries?autoplay=1&list={l}&loop=1"),
            _ => unreachable!(),
        };
        let title = oembed("https://www.youtube.com/oembed?format=json&url=", u);
        return Ok(json!({ "kind": "youtube", "url": u, "embed": embed, "title": if title.is_empty() { "YouTube".into() } else { title } }));
    }
    if low.contains("soundcloud.com/") {
        let enc: String = u.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
        let title = oembed("https://soundcloud.com/oembed?format=json&url=", u);
        return Ok(json!({ "kind": "soundcloud", "url": u, "embed": format!("https://w.soundcloud.com/player/?url={enc}&auto_play=true&visual=true"), "title": if title.is_empty() { "SoundCloud".into() } else { title } }));
    }
    if low.contains("open.spotify.com/") {
        let path = u.split("open.spotify.com/").nth(1).unwrap_or("").split('?').next().unwrap_or("");
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && !p.starts_with("intl-")).collect();
        let (Some(kind), Some(id)) = (parts.first(), parts.get(1)) else { return Err("Link Spotify không đúng".into()) };
        if !["track", "album", "playlist", "episode", "show", "artist"].contains(kind) {
            return Err("Link Spotify không đúng".into());
        }
        let title = oembed("https://open.spotify.com/oembed?url=", u);
        return Ok(json!({ "kind": "spotify", "url": u, "embed": format!("https://open.spotify.com/embed/{kind}/{id}?autoplay=1"), "title": if title.is_empty() { "Spotify".into() } else { title } }));
    }
    Err("Dán link YouTube, SoundCloud hoặc Spotify".into())
}

// ---------------------------------------------------------------- web wallpapers
fn live_dir() -> PathBuf {
    walls_dir().join("live")
}

fn copy_tree(from: &Path, to: &Path, budget: &mut u64) -> R<()> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for e in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        let name = e.file_name();
        let n = name.to_string_lossy();
        if n == ".git" || n == "node_modules" {
            continue;
        }
        if p.is_dir() {
            copy_tree(&p, &to.join(&name), budget)?;
        } else {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            if size > *budget {
                return Err("Gói quá lớn".into());
            }
            *budget -= size;
            fs::copy(&p, to.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The page of a package: the shallowest index.html (Wallpaper Engine's project.json / Lively's
/// LivelyInfo.json name their own file).
fn page_of(root: &Path) -> Option<(String, String, String)> {
    let mut files = vec![];
    walk(root, 0, &mut files);
    let rel = |p: &Path| p.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
    let mut by_depth = files.clone();
    by_depth.sort_by_key(|p| rel(p).matches('/').count());
    for f in &by_depth {
        let n = f.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        let dir = f.parent().unwrap_or(root);
        if n == "project.json" {
            if let Some(v) = fs::read(f).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                if v["type"].as_str().map(|t| t.eq_ignore_ascii_case("web")).unwrap_or(false) {
                    let page = dir.join(v["file"].as_str().unwrap_or("index.html"));
                    if page.exists() {
                        let preview = v["preview"].as_str().map(|p| rel(&dir.join(p))).unwrap_or_default();
                        return Some((rel(&page), v["title"].as_str().unwrap_or("").to_string(), preview));
                    }
                }
            }
        }
        if n == "livelyinfo.json" {
            if let Some(v) = fs::read(f).ok().and_then(|b| serde_json::from_slice::<Value>(&String::from_utf8_lossy(&b).trim_start_matches('\u{feff}').as_bytes().to_vec()).ok()) {
                let page = dir.join(v["FileName"].as_str().unwrap_or("index.html"));
                if page.exists() {
                    let preview = v["Thumbnail"].as_str().or(v["Preview"].as_str()).map(|p| rel(&dir.join(p))).unwrap_or_default();
                    return Some((rel(&page), v["Title"].as_str().unwrap_or("").to_string(), preview));
                }
            }
        }
    }
    by_depth.iter().find(|f| f.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case("index.html")).unwrap_or(false)).map(|f| (rel(f), String::new(), String::new()))
}

fn install_folder(src: &Path, meta: Value) -> R<Value> {
    let (page, title, preview) = page_of(src).ok_or("Không tìm thấy trang index.html trong gói")?;
    let base = meta["title"].as_str().filter(|t| !t.is_empty()).map(String::from).or_else(|| (!title.is_empty()).then(|| title.clone())).unwrap_or_else(|| src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "web".into()));
    let id = walls::unique(&live_dir(), &base, "web").trim_end_matches(".web").to_string();
    let to = live_dir().join(&id);
    let mut budget = 500 * 1024 * 1024u64;
    if let Err(e) = copy_tree(src, &to, &mut budget) {
        let _ = fs::remove_dir_all(&to);
        return Err(e);
    }
    let info = json!({ "id": id, "title": if title.is_empty() { base } else { title }, "page": page, "preview": preview, "added": now_ms(), "source": meta["source"], "repo": meta["repo"], "license": meta["license"], "link": meta["page"] });
    let _ = fs::write(to.join("unk-web.json"), info.to_string());
    // (in TyranWeb's folder: in its list too, so TyranWeb has it as well)
    if walls::tyran_root().is_some() {
        let mut list = tyran_live();
        let prev = info["preview"].as_str().filter(|p| !p.is_empty()).map(|p| format!("live/{id}/{p}"));
        list.insert(0, json!({ "id": id, "title": info["title"], "entry": info["page"], "preview": prev, "kind": "web", "page": meta["page"], "repo": meta["repo"], "license": meta["license"], "source": meta["source"], "added": info["added"] }));
        tyran_live_write(&list);
    }
    walls::changed(&AppHandle);
    Ok(with_urls(info))
}

fn with_urls(mut v: Value) -> Value {
    let dir = live_dir().join(v["id"].as_str().unwrap_or(""));
    v["url"] = json!(file_url(&dir.join(v["page"].as_str().unwrap_or("index.html"))));
    let prev = v["preview"].as_str().unwrap_or("").to_string();
    v["previewUrl"] = json!(if prev.is_empty() || !dir.join(&prev).exists() { String::new() } else { file_url(&dir.join(prev)) });
    v
}

/// A web wallpaper package from a folder or a zip.
pub fn web_import(path: &str) -> R<Value> {
    let p = PathBuf::from(path);
    if p.is_dir() {
        return install_folder(&p, json!({ "source": "folder" }));
    }
    let tmp = std::env::temp_dir().join(format!("unknowweb-web-{}", now_ms()));
    let r = (|| {
        let f = fs::File::open(&p).map_err(|e| e.to_string())?;
        let mut z = zip::ZipArchive::new(f).map_err(|_| "Không đọc được file zip".to_string())?;
        z.extract(&tmp).map_err(|e| e.to_string())?;
        let title = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        install_folder(&tmp, json!({ "source": "zip", "title": title }))
    })();
    let _ = fs::remove_dir_all(&tmp);
    r
}

/// TyranWeb's list of its web wallpapers (live/index.json: {id, title, entry, preview, kind, …}).
fn tyran_live() -> Vec<Value> {
    if walls::tyran_root().is_none() {
        return vec![];
    }
    fs::read_to_string(live_dir().join("index.json")).ok().and_then(|s| serde_json::from_str::<Vec<Value>>(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default()
}
fn tyran_live_write(list: &[Value]) {
    let _ = fs::write(live_dir().join("index.json"), serde_json::to_vec_pretty(list).unwrap_or_default());
}

pub fn web_list() -> Value {
    let mut out = vec![];
    let mut seen = std::collections::HashSet::new();
    if let Ok(rd) = fs::read_dir(live_dir()) {
        for e in rd.flatten() {
            if let Some(v) = fs::read(e.path().join("unk-web.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                seen.insert(v["id"].as_str().unwrap_or("").to_string());
                out.push(with_urls(v));
            }
        }
    }
    // (TyranWeb's own, as it lists them: its preview lies beside its pictures' thumbnails)
    for w in tyran_live() {
        let id = w["id"].as_str().unwrap_or("").to_string();
        if id.is_empty() || seen.contains(&id) || !live_dir().join(&id).is_dir() {
            continue;
        }
        let entry = w["entry"].as_str().unwrap_or("index.html").to_string();
        let preview = w["preview"].as_str().map(|p| walls_dir().join(p)).filter(|p| p.exists());
        out.push(json!({
            "id": id, "title": w["title"], "page": entry, "added": w["added"], "source": w["source"], "repo": w["repo"], "license": w["license"], "link": w["page"], "tyran": true,
            "url": file_url(&live_dir().join(&id).join(&entry)),
            "previewUrl": preview.map(|p| file_url(&p)).unwrap_or_default(),
        }));
    }
    out.sort_by(|a, b| b["added"].as_u64().cmp(&a["added"].as_u64()));
    json!(out)
}

pub fn web_remove(id: &str) {
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return;
    }
    let _ = fs::remove_dir_all(live_dir().join(id));
    let list = tyran_live();
    if list.iter().any(|w| w["id"] == id) {
        tyran_live_write(&list.into_iter().filter(|w| w["id"] != id).collect::<Vec<_>>());
    }
    walls::changed(&AppHandle);
}

// ---------------------------------------------------------------- Specials (GitHub)
const TOPICS: &[&str] = &["wallpaper-engine", "lively-wallpaper", "live-wallpaper"];

fn gh_get(url: &str) -> R<Value> {
    match ureq::get(url).timeout(Duration::from_secs(20)).set("User-Agent", UA).set("Accept", "application/vnd.github+json").call() {
        Ok(r) => r.into_string().map_err(|e| e.to_string()).and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string())),
        Err(ureq::Error::Status(403 | 429, _)) => Err("rate".into()),
        Err(e) => Err(e.to_string()),
    }
}

fn enc(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// A search's page: the repositories of the three tags, the most starred first.
pub fn specials_search(q: &str, page: u32) -> R<Value> {
    let q: String = q.chars().filter(|c| c.is_alphanumeric() || " ._-".contains(*c)).take(80).collect();
    let page = page.clamp(1, 30);
    let handles: Vec<_> = TOPICS
        .iter()
        .map(|topic| {
            let url = format!("https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page=30&page={page}", enc(&format!("{}topic:{topic} fork:false", if q.trim().is_empty() { String::new() } else { format!("{} ", q.trim()) })));
            std::thread::spawn(move || gh_get(&url))
        })
        .collect();
    let results: Vec<R<Value>> = handles.into_iter().map(|h| h.join().unwrap_or(Err("error".into()))).collect();
    if results.iter().all(|r| r.is_err()) {
        return Err(if results.iter().any(|r| r.as_ref().err().map(|e| e == "rate").unwrap_or(false)) { "GitHub tạm giới hạn lượt tìm, thử lại sau ít phút".into() } else { "Không kết nối được GitHub".into() });
    }
    let mut seen: HashMap<String, Value> = HashMap::new();
    for r in results.iter().flatten() {
        for it in r["items"].as_array().cloned().unwrap_or_default() {
            let full = it["full_name"].as_str().unwrap_or("").to_string();
            if full.is_empty() || seen.contains_key(&full) {
                continue;
            }
            let lic = it["license"]["spdx_id"].as_str().filter(|l| *l != "NOASSERTION").unwrap_or("");
            seen.insert(full.clone(), json!({ "id": full, "name": it["name"], "owner": it["owner"]["login"], "desc": it["description"].as_str().unwrap_or("").chars().take(300).collect::<String>(), "stars": it["stargazers_count"], "license": lic, "size": it["size"].as_u64().unwrap_or(0) * 1024, "branch": it["default_branch"].as_str().unwrap_or("main"), "pushed": it["pushed_at"], "topics": it["topics"], "url": it["html_url"] }));
        }
    }
    let mut items: Vec<Value> = seen.into_values().collect();
    items.sort_by(|a, b| b["stars"].as_u64().cmp(&a["stars"].as_u64()));
    Ok(json!({ "items": items, "partial": results.iter().any(|r| r.is_err()) }))
}

fn ok_repo(full: &str, branch: &str) -> bool {
    let repo_ok = full.split_once('/').is_some_and(|(o, r)| !o.is_empty() && !r.is_empty() && !r.contains('/') && full.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c)));
    repo_ok && !branch.is_empty() && branch.len() <= 100 && branch.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c)) && !branch.contains("..")
}

/// What a repository holds: { kind: we | lively | web | '', title, preview, dir }
pub fn specials_inspect(full: &str, branch: &str) -> R<Value> {
    static LOOKED: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    if !ok_repo(full, branch) {
        return Err("bad repo".into());
    }
    let key = format!("{full}@{branch}");
    if let Some(v) = LOOKED.get_or_init(Default::default).lock().unwrap().get(&key) {
        return Ok(v.clone());
    }
    let base = format!("https://raw.githubusercontent.com/{full}/{branch}/");
    let text = |f: &str| -> Option<String> { ureq::get(&format!("{base}{}", f.split('/').map(enc).collect::<Vec<_>>().join("/"))).timeout(Duration::from_secs(15)).set("User-Agent", UA).call().ok()?.into_string().ok() };
    // (its files, listed by jsDelivr: GitHub's own listing has an hourly limit)
    let files: Option<Vec<String>> = ureq::get(&format!("https://data.jsdelivr.com/v1/packages/gh/{full}@{}?structure=flat", enc(branch)))
        .timeout(Duration::from_secs(15))
        .call()
        .ok()
        .and_then(|r| r.into_string().ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["files"].as_array().map(|a| a.iter().filter_map(|f| f["name"].as_str().map(|n| n.trim_start_matches('/').to_string())).collect()));
    let pick = |name: &str| -> Vec<String> {
        match &files {
            Some(list) => {
                let mut l: Vec<String> = list.iter().filter(|f| f.rsplit('/').next().unwrap_or("").eq_ignore_ascii_case(name) && !f.contains("node_modules/") && !f.contains(".github/")).cloned().collect();
                l.sort_by_key(|f| f.matches('/').count());
                l.truncate(3);
                l
            }
            None => vec![name.to_string()],
        }
    };
    let dir_of = |f: &str| f.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
    let join = |dir: &str, f: &str| if f.is_empty() || f.contains("..") || f.contains(':') { String::new() } else { format!("{base}{}", [dir, &f.replace('\\', "/").trim_start_matches('/').to_string()].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join("/")) };
    let mut out = json!({ "kind": "" });
    for f in pick("project.json") {
        let Some(v) = text(&f).and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) else { continue };
        if v["type"].as_str().map(|t| t.eq_ignore_ascii_case("web")).unwrap_or(false) {
            out = json!({ "kind": "we", "title": v["title"].as_str().unwrap_or(""), "preview": join(&dir_of(&f), v["preview"].as_str().unwrap_or("")), "dir": dir_of(&f) });
            break;
        }
        if out["why"].is_null() && v["type"].is_string() {
            out["why"] = v["type"].clone();
        }
    }
    if out["kind"] == "" {
        for f in pick("LivelyInfo.json") {
            let Some(v) = text(&f).and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) else { continue };
            if [Some(1), Some(2)].contains(&v["Type"].as_u64()) {
                out = json!({ "kind": "lively", "title": v["Title"].as_str().unwrap_or(""), "preview": join(&dir_of(&f), v["Thumbnail"].as_str().or(v["Preview"].as_str()).unwrap_or("")), "dir": dir_of(&f) });
                break;
            }
        }
    }
    if out["kind"] == "" && out["why"].is_null() {
        let has_index = match &files {
            Some(l) => l.iter().any(|f| f == "index.html"),
            None => text("index.html").is_some(),
        };
        if has_index {
            out = json!({ "kind": "web", "title": "", "preview": "", "dir": "" });
        }
    }
    LOOKED.get_or_init(Default::default).lock().unwrap().insert(key, out.clone());
    Ok(out)
}

fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static J: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    J.get_or_init(Default::default)
}

/// GitHub's zip of a repository, unpacked, installed as a web wallpaper package (`specials-progress`).
pub fn specials_install(item: Value) -> R<Value> {
    let (id, full, branch) = (item["id"].as_str().unwrap_or("").to_string(), item["full"].as_str().unwrap_or("").to_string(), item["branch"].as_str().unwrap_or("").to_string());
    if !ok_repo(&full, &branch) {
        return Err("bad repo".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    jobs().lock().unwrap().insert(id.clone(), stop.clone());
    let tmp = std::env::temp_dir().join(format!("unknowweb-special-{}", now_ms()));
    let _ = fs::create_dir_all(&tmp);
    let r = (|| -> R<Value> {
        let res = ureq::get(&format!("https://codeload.github.com/{full}/zip/refs/heads/{branch}")).timeout(Duration::from_secs(600)).set("User-Agent", UA).call().map_err(|e| e.to_string())?;
        let total: u64 = res.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(item["size"].as_u64().unwrap_or(0));
        let zip_path = tmp.join("repo.zip");
        let mut out = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut reader = res.into_reader();
        let mut buf = vec![0u8; 256 * 1024];
        let (mut got, mut told) = (0u64, Instant::now());
        loop {
            if stop.load(Ordering::Relaxed) {
                return Err("cancelled".into());
            }
            let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            got += n as u64;
            if got > 400 * 1024 * 1024 {
                return Err("Kho quá lớn".into());
            }
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            if told.elapsed() > Duration::from_millis(200) {
                told = Instant::now();
                let _ = AppHandle.emit("specials-progress", json!({ "id": id, "got": got, "total": total }));
            }
        }
        drop(out);
        let x = tmp.join("x");
        let mut z = zip::ZipArchive::new(fs::File::open(&zip_path).map_err(|e| e.to_string())?).map_err(|_| "Không đọc được file zip".to_string())?;
        z.extract(&x).map_err(|e| e.to_string())?;
        // (GitHub's zip has one folder: <repo>-<branch>; the wallpaper may be deeper, as inspect found)
        let tops: Vec<PathBuf> = fs::read_dir(&x).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        let root = if tops.len() == 1 { tops[0].clone() } else { x.clone() };
        let found = specials_inspect(&full, &branch).ok().and_then(|v| v["dir"].as_str().map(String::from)).unwrap_or_default();
        let folder = found.split('/').filter(|s| !s.is_empty() && *s != "..").fold(root.clone(), |p, s| p.join(s));
        let _ = AppHandle.emit("specials-progress", json!({ "id": id, "got": got, "total": got }));
        install_folder(if folder.exists() { &folder } else { &root }, json!({ "title": full.split('/').nth(1).unwrap_or(""), "page": format!("https://github.com/{full}"), "repo": full, "license": item["license"], "source": "GitHub" }))
    })();
    jobs().lock().unwrap().remove(&id);
    let _ = fs::remove_dir_all(&tmp);
    r
}

pub fn specials_cancel(id: &str) {
    if let Some(s) = jobs().lock().unwrap().get(id) {
        s.store(true, Ordering::Relaxed);
    }
}

#[allow(dead_code)]
fn _app(a: &AppHandle) -> &App {
    a.state::<App>()
}
