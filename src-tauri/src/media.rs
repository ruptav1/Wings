//! Videos and sounds found on pages (what the page's player loads), and the browser's own downloader
//! for them: plain files (mp4, webm, mp3…) and HLS streams (.m3u8: the best variant, its segments
//! decrypted when AES-128, joined into one .ts file that common players open).
use crate::{state::App, store::now_ms};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
static CANCELLED: Mutex<Option<HashSet<u32>>> = Mutex::new(None);

/// What kind of media a response is, if any ("hls" | "video" | "audio").
pub fn classify(url: &str, content_type: &str) -> Option<&'static str> {
    let ct = content_type.to_lowercase();
    let path = url.split(['?', '#']).next().unwrap_or("").to_lowercase();
    if url.contains("googlevideo.com/") {
        return None; // (YouTube's player loads pieces of streams that are not files of their own)
    }
    if ct.contains("mpegurl") || path.ends_with(".m3u8") {
        return Some("hls");
    }
    if ct.contains("mp2t") || path.ends_with(".ts") || path.ends_with(".m4s") {
        return None; // (segments of a stream)
    }
    if ct.starts_with("video/") || [".mp4", ".webm", ".m4v", ".mov", ".mkv"].iter().any(|e| path.ends_with(e)) {
        return Some("video");
    }
    if ct.starts_with("audio/") || [".mp3", ".m4a", ".ogg", ".opus", ".flac", ".wav"].iter().any(|e| path.ends_with(e)) {
        return Some("audio");
    }
    None
}

pub fn cancel(id: u32) {
    CANCELLED.lock().unwrap().get_or_insert_with(HashSet::new).insert(id);
}
pub(crate) fn is_cancelled(id: u32) -> bool {
    CANCELLED.lock().unwrap().as_ref().is_some_and(|s| s.contains(&id))
}

fn file_name_for(url: &str, title: &str, ext: &str) -> String {
    let from_title: String = title.chars().map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { '_' } else { c }).take(90).collect();
    let base = if from_title.trim().is_empty() {
        url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("video").split('.').next().unwrap_or("video").to_string()
    } else {
        from_title.trim().to_string()
    };
    format!("{}.{ext}", if base.is_empty() { "video".into() } else { base })
}

fn unique(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (1..1000).map(|i| dir.join(format!("{stem} ({i}).{ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

pub(crate) struct Job {
    pub app: AppHandle,
    pub base: Value,
    pub id: u32,
    pub last: Instant,
}
impl Job {
    pub fn emit(&mut self, state: &str, got: u64, total: i64, force: bool) {
        if !force && self.last.elapsed().as_millis() < 250 {
            return;
        }
        self.last = Instant::now();
        let mut v = self.base.clone();
        v["state"] = json!(state);
        v["received"] = json!(got);
        v["total"] = json!(total);
        if state != "progressing" {
            v["ended"] = json!(now_ms());
            let st = self.app.state::<App>();
            let mut doc = st.store.downloads.lock().unwrap();
            if let Some(items) = doc.value["items"].as_array_mut() {
                items.insert(0, v.clone());
                items.truncate(500);
            }
            doc.touch();
        }
        let _ = self.app.emit("download", v);
    }
}

fn get(url: &str, referer: &str, cookies: &str) -> Result<ureq::Response, String> {
    let mut r = ureq::get(url).timeout(Duration::from_secs(60)).set("User-Agent", UA);
    if !referer.is_empty() {
        let origin = referer.split('/').take(3).collect::<Vec<_>>().join("/");
        r = r.set("Referer", referer).set("Origin", &origin);
    }
    if !cookies.is_empty() {
        r = r.set("Cookie", cookies);
    }
    r.call().map_err(|e| e.to_string())
}

fn resolve(base: &str, rel: &str) -> String {
    if rel.starts_with("http://") || rel.starts_with("https://") {
        return rel.to_string();
    }
    if rel.starts_with("//") {
        let scheme = base.split(':').next().unwrap_or("https");
        return format!("{scheme}:{rel}");
    }
    let origin: String = base.split('/').take(3).collect::<Vec<_>>().join("/");
    if rel.starts_with('/') {
        return format!("{origin}{rel}");
    }
    let dir = base.split(['?', '#']).next().unwrap_or(base);
    let dir = &dir[..dir.rfind('/').map(|i| i + 1).unwrap_or(dir.len())];
    format!("{dir}{rel}")
}

/// Starts a download in the background; returns its id at once.
pub fn start(app: AppHandle, url: String, kind: String, title: String, referer: String, cookies: String) -> u32 {
    let id = crate::wv2::NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed);
    std::thread::spawn(move || {
        let dir = app.state::<App>().download_dir();
        let _ = std::fs::create_dir_all(&dir);
        let is_hls = kind == "hls";
        let ext = if is_hls {
            "ts".to_string()
        } else {
            let p = url.split(['?', '#']).next().unwrap_or("").to_lowercase();
            p.rsplit_once('.').map(|(_, e)| e.to_string()).filter(|e| e.len() <= 4 && e.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_else(|| if kind == "audio" { "mp3".into() } else { "mp4".into() })
        };
        let path = unique(&dir, &file_name_for(&url, &title, &ext));
        let base = json!({ "id": id, "url": url, "path": path.to_string_lossy(), "file": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), "started": now_ms(), "private": false, "own": true });
        let mut job = Job { app: app.clone(), base, id, last: Instant::now() - Duration::from_secs(1) };
        job.emit("progressing", 0, -1, true);
        let r = if is_hls { hls(&mut job, &url, &referer, &cookies, &path) } else { direct(&mut job, &url, &referer, &cookies, &path) };
        match r {
            Ok(n) => job.emit("completed", n, n as i64, true),
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                let cancelled = is_cancelled(id);
                job.base["error"] = json!(e);
                job.emit(if cancelled { "cancelled" } else { "interrupted" }, 0, -1, true);
            }
        }
    });
    id
}

fn direct(job: &mut Job, url: &str, referer: &str, cookies: &str, path: &Path) -> Result<u64, String> {
    let resp = get(url, referer, cookies)?;
    let total: i64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(-1);
    let mut reader = resp.into_reader();
    let mut f = File::create(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut got = 0u64;
    loop {
        if is_cancelled(job.id) {
            return Err("cancelled".into());
        }
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        job.emit("progressing", got, total, false);
    }
    Ok(got)
}

fn text(url: &str, referer: &str, cookies: &str) -> Result<String, String> {
    get(url, referer, cookies)?.into_string().map_err(|e| e.to_string())
}

fn attr<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    let i = line.find(&format!("{name}="))? + name.len() + 1;
    let rest = &line[i..];
    if let Some(r) = rest.strip_prefix('"') {
        r.split('"').next()
    } else {
        rest.split(',').next()
    }
}

fn hls(job: &mut Job, url: &str, referer: &str, cookies: &str, path: &Path) -> Result<u64, String> {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    type Dec = cbc::Decryptor<aes::Aes128>;

    let mut url = url.to_string();
    let mut list = text(&url, referer, cookies)?;
    // a master playlist: the variant with the most bandwidth
    if list.contains("#EXT-X-STREAM-INF") {
        let lines: Vec<&str> = list.lines().collect();
        let mut best: Option<(u64, String)> = None;
        for (i, l) in lines.iter().enumerate() {
            if l.starts_with("#EXT-X-STREAM-INF") {
                let bw: u64 = attr(l, "BANDWIDTH").and_then(|b| b.parse().ok()).unwrap_or(0);
                if let Some(u) = lines[i + 1..].iter().find(|x| !x.trim().is_empty() && !x.starts_with('#')) {
                    if best.as_ref().map_or(true, |(b, _)| bw > *b) {
                        best = Some((bw, resolve(&url, u.trim())));
                    }
                }
            }
        }
        let (_, variant) = best.ok_or("Danh sách phát không có luồng nào")?;
        list = text(&variant, referer, cookies)?;
        url = variant;
    }
    // the segments, with their key and IV
    struct Seg {
        url: String,
        key: Option<(String, Option<[u8; 16]>)>,
        seq: u64,
    }
    let mut segs = vec![];
    let mut key: Option<(String, Option<[u8; 16]>)> = None;
    let mut seq: u64 = 0;
    let mut map_url: Option<String> = None;
    for l in list.lines().map(str::trim) {
        if let Some(v) = l.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            seq = v.parse().unwrap_or(0);
        } else if l.starts_with("#EXT-X-KEY") {
            let method = attr(l, "METHOD").unwrap_or("NONE");
            key = match method {
                "NONE" => None,
                "AES-128" => {
                    let uri = attr(l, "URI").ok_or("Thiếu khóa giải mã")?;
                    let iv = attr(l, "IV").and_then(|h| {
                        let h = h.trim_start_matches("0x").trim_start_matches("0X");
                        let mut b = [0u8; 16];
                        for i in 0..16 {
                            b[i] = u8::from_str_radix(h.get(i * 2..i * 2 + 2)?, 16).ok()?;
                        }
                        Some(b)
                    });
                    Some((resolve(&url, uri), iv))
                }
                _ => return Err("Luồng này dùng kiểu mã hóa (DRM) không tải được".into()),
            };
        } else if l.starts_with("#EXT-X-MAP") {
            map_url = attr(l, "URI").map(|u| resolve(&url, u));
        } else if !l.is_empty() && !l.starts_with('#') {
            segs.push(Seg { url: resolve(&url, l), key: key.clone(), seq });
            seq += 1;
        }
    }
    if segs.is_empty() {
        return Err("Danh sách phát trống".into());
    }
    let mut f = File::create(path).map_err(|e| e.to_string())?;
    let mut got = 0u64;
    if let Some(m) = map_url {
        let mut b = vec![];
        get(&m, referer, cookies)?.into_reader().read_to_end(&mut b).map_err(|e| e.to_string())?;
        f.write_all(&b).map_err(|e| e.to_string())?;
    }
    let mut keys: std::collections::HashMap<String, Vec<u8>> = Default::default();
    let n = segs.len();
    for (i, seg) in segs.iter().enumerate() {
        if is_cancelled(job.id) {
            return Err("cancelled".into());
        }
        let mut data = vec![];
        let mut tries = 0;
        loop {
            data.clear();
            match get(&seg.url, referer, cookies).and_then(|r| r.into_reader().read_to_end(&mut data).map_err(|e| e.to_string())) {
                Ok(_) => break,
                Err(e) if tries >= 3 => return Err(e),
                Err(_) => tries += 1,
            }
        }
        if let Some((kurl, iv)) = &seg.key {
            if !keys.contains_key(kurl) {
                let mut k = vec![];
                get(kurl, referer, cookies)?.into_reader().read_to_end(&mut k).map_err(|e| e.to_string())?;
                keys.insert(kurl.clone(), k);
            }
            let k = &keys[kurl];
            if k.len() != 16 {
                return Err("Khóa giải mã không hợp lệ".into());
            }
            let iv = iv.unwrap_or_else(|| {
                let mut b = [0u8; 16];
                b[8..].copy_from_slice(&seg.seq.to_be_bytes());
                b
            });
            data = Dec::new(k.as_slice().into(), &iv.into()).decrypt_padded_vec_mut::<Pkcs7>(&data).map_err(|_| "Giải mã thất bại".to_string())?;
        }
        f.write_all(&data).map_err(|e| e.to_string())?;
        got += data.len() as u64;
        // (progress by segments: the total size of a stream is not known ahead)
        let est = if i > 0 { (got as f64 / (i + 1) as f64 * n as f64) as i64 } else { -1 };
        job.emit("progressing", got, est, false);
    }
    Ok(got)
}
