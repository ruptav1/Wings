//! Tải từ đường dẫn: the videos of a post from its link on YouTube, X, Facebook, Reddit, Instagram,
//! TikTok, Bilibili and the many other sites yt-dlp reads. What a link holds is read with `yt-dlp -J`
//! (each video with its picture, length and the qualities it comes in); the one picked is downloaded
//! by yt-dlp into the download folder, its progress shown in Tải xuống as the browser's own downloads
//! are. The user's login on that site goes with it as a cookie file (deleted afterwards).
//!
//! The programs, fetched on first use into profile/tools:
//! - yt-dlp (github.com/yt-dlp/yt-dlp, Unlicense): its official Windows build from its latest release,
//!   checked against that release's SHA2-256SUMS, then kept current by its own updater (sites change
//!   often), at most every 3 days or when it fails on a link;
//! - FFmpeg, to join a video with its separate sound and to make MP3s: one already on this PC (in PATH
//!   or winget's links), else ffmpeg.exe 6.1.1 from github.com/eugeneware/ffmpeg-static (GPL-3.0),
//!   its SHA-256 fixed here.
use crate::{
    media::{is_cancelled, Job},
    state::App,
    store::now_ms,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Read},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
const NO_WINDOW: u32 = 0x0800_0000;
const YTDLP_FROM: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const FFMPEG_URL: &str = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz";
const FFMPEG_GZ_SHA: &str = "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77";
const FFMPEG_EXE_SHA: &str = "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00";

fn tools(app: &AppHandle) -> PathBuf {
    app.state::<App>().profile.join("tools")
}
fn sha(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

// one fetch of a program at a time
static FETCHING: Mutex<()> = Mutex::new(());

/// Downloads `url`, telling the interface how far it got (`grab-tool` { name, done }).
fn fetch(app: &AppHandle, url: &str, name: &str) -> R<Vec<u8>> {
    let resp = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(60)).build().get(url).call().map_err(err)?;
    let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut r = resp.into_reader();
    let mut out = Vec::with_capacity(total as usize);
    let mut buf = vec![0u8; 256 * 1024];
    let mut told = Instant::now();
    loop {
        let n = r.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        if total > 0 && told.elapsed() > Duration::from_millis(250) {
            told = Instant::now();
            let _ = app.emit("grab-tool", json!({ "name": name, "done": out.len() as f64 / total as f64 }));
        }
    }
    Ok(out)
}

fn place(file: &Path, bytes: &[u8]) -> R<()> {
    std::fs::create_dir_all(file.parent().unwrap()).map_err(err)?;
    let part = file.with_extension("part");
    std::fs::write(&part, bytes).map_err(err)?;
    std::fs::rename(&part, file).map_err(err)
}

fn ytdlp(app: &AppHandle) -> R<PathBuf> {
    let exe = tools(app).join("yt-dlp.exe");
    if exe.exists() {
        return Ok(exe);
    }
    let _g = FETCHING.lock().unwrap();
    if exe.exists() {
        return Ok(exe);
    }
    let _ = app.emit("grab-tool", json!({ "name": "yt-dlp", "done": 0 }));
    let sums = ureq::get(&format!("{YTDLP_FROM}SHA2-256SUMS")).timeout(Duration::from_secs(30)).call().map_err(err)?.into_string().map_err(err)?;
    let want = sums.lines().find_map(|l| {
        let (h, f) = l.split_once(char::is_whitespace)?;
        (f.trim().trim_start_matches('*') == "yt-dlp.exe").then(|| h.to_lowercase())
    });
    let Some(want) = want else { return Err("Không đọc được mã kiểm tra của yt-dlp".into()) };
    let bytes = fetch(app, &format!("{YTDLP_FROM}yt-dlp.exe"), "yt-dlp")?;
    if sha(&bytes) != want {
        return Err("yt-dlp tải về không khớp mã kiểm tra, đã bỏ".into());
    }
    place(&exe, &bytes)?;
    let _ = std::fs::write(tools(app).join("yt-dlp.checked"), now_ms().to_string());
    let _ = app.emit("grab-tool", json!({ "name": "yt-dlp", "done": 1 }));
    Ok(exe)
}

/// yt-dlp's own update (it checks what it fetches): every 3 days, or (`force`) after it failed on a
/// link and was not checked within the hour.
fn update(app: &AppHandle, force: bool) {
    let exe = tools(app).join("yt-dlp.exe");
    let stamp = tools(app).join("yt-dlp.checked");
    let at: u64 = std::fs::read_to_string(&stamp).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    let wait = if force { 3_600_000 } else { 3 * 86_400_000 };
    if !exe.exists() || now_ms().saturating_sub(at) < wait {
        return;
    }
    let _ = std::fs::write(&stamp, now_ms().to_string());
    let _ = Command::new(&exe).arg("-U").creation_flags(NO_WINDOW).stdout(Stdio::null()).stderr(Stdio::null()).status();
}

fn ffmpeg_here(app: &AppHandle) -> Option<PathBuf> {
    let own = tools(app).join("ffmpeg.exe");
    if own.exists() {
        return Some(own);
    }
    let mut dirs: Vec<PathBuf> = std::env::var("PATH").unwrap_or_default().split(';').map(|d| PathBuf::from(d.trim().trim_matches('"'))).filter(|d| !d.as_os_str().is_empty()).collect();
    if let Ok(l) = std::env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(l).join("Microsoft").join("WinGet").join("Links"));
    }
    dirs.into_iter().map(|d| d.join("ffmpeg.exe")).find(|f| f.is_file())
}

fn ffmpeg(app: &AppHandle) -> R<PathBuf> {
    if let Some(f) = ffmpeg_here(app) {
        return Ok(f);
    }
    let _g = FETCHING.lock().unwrap();
    let own = tools(app).join("ffmpeg.exe");
    if own.exists() {
        return Ok(own);
    }
    let _ = app.emit("grab-tool", json!({ "name": "FFmpeg", "done": 0 }));
    let gz = fetch(app, FFMPEG_URL, "FFmpeg")?;
    if sha(&gz) != FFMPEG_GZ_SHA {
        return Err("FFmpeg tải về không khớp mã kiểm tra, đã bỏ".into());
    }
    let mut exe = vec![];
    flate2::read::GzDecoder::new(&gz[..]).read_to_end(&mut exe).map_err(err)?;
    if sha(&exe) != FFMPEG_EXE_SHA {
        return Err("FFmpeg tải về không khớp mã kiểm tra, đã bỏ".into());
    }
    place(&own, &exe)?;
    let _ = app.emit("grab-tool", json!({ "name": "FFmpeg", "done": 1 }));
    Ok(own)
}

/// The tools' state, for the panel: whether yt-dlp is here yet, which FFmpeg is used.
#[tauri::command]
pub fn grab_tools(app: AppHandle) -> Value {
    json!({ "ytdlp": tools(&app).join("yt-dlp.exe").exists(), "ffmpeg": ffmpeg_here(&app).map(|p| p.to_string_lossy().to_string()) })
}

fn command(exe: &Path) -> Command {
    let mut c = Command::new(exe);
    // (titles in any language, written and printed as UTF-8)
    c.creation_flags(NO_WINDOW).env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
    c
}

/// The user's cookies for the link's site, as a Netscape cookie file for yt-dlp (None without any).
fn cookie_file(app: &AppHandle, url: &str) -> Option<PathBuf> {
    let (tx, rx) = std::sync::mpsc::channel();
    let u = url.to_string();
    let _ = app.run_on_main_thread(move || crate::extras::cookies_netscape(&u, move |c| drop(tx.send(c))));
    let text = rx.recv_timeout(Duration::from_secs(3)).ok()?;
    if text.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()).count() == 0 {
        return None;
    }
    let f = tools(app).join(format!("cookies-{}.txt", now_ms()));
    std::fs::create_dir_all(tools(app)).ok()?;
    std::fs::write(&f, text).ok()?;
    Some(f)
}

/// yt-dlp's last ERROR line, said plainly.
fn error_of(stderr: &str) -> String {
    let line = stderr.lines().rev().find(|l| l.starts_with("ERROR")).unwrap_or_else(|| stderr.lines().last().unwrap_or("")).trim();
    let line = line.trim_start_matches("ERROR:").trim();
    if line.contains("Unsupported URL") {
        "Trang này chưa được hỗ trợ".into()
    } else if line.contains("Sign in") || line.contains("login") || line.contains("cookies") {
        format!("Cần đăng nhập trang này trong trình duyệt trước ({line})")
    } else if line.contains("Private video") || line.contains("private") {
        "Video riêng tư".into()
    } else if line.is_empty() {
        "yt-dlp không đọc được link này".into()
    } else {
        line.chars().take(300).collect()
    }
}

// ---------- what a link holds ----------
const LEVELS: [u64; 8] = [4320, 2160, 1440, 1080, 720, 480, 360, 240];

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
/// A format's size: as the site gives it, else its bitrate times the length (0: not known).
fn size_of(f: &Value, duration: f64) -> f64 {
    let s = num(&f["filesize"]);
    if s > 0.0 {
        return s;
    }
    let a = num(&f["filesize_approx"]);
    if a > 0.0 {
        return a;
    }
    num(&f["tbr"]) * 125.0 * duration
}

/// The qualities an entry comes in: each height once (its best video, H.264 preferred, with the best
/// sound), then its sound alone.
fn choices(info: &Value) -> Vec<Value> {
    let formats = info["formats"].as_array().cloned().unwrap_or_default();
    let duration = num(&info["duration"]);
    let size_of = |f: &Value| size_of(f, duration);
    let has_video = |f: &Value| f["vcodec"].as_str().map(|c| c != "none").unwrap_or(f["height"].is_number());
    let has_audio = |f: &Value| f["acodec"].as_str().map(|c| c != "none").unwrap_or(false);
    let audio = formats.iter().filter(|f| has_audio(f) && !has_video(f)).max_by(|a, b| num(&a["abr"]).total_cmp(&num(&b["abr"])));
    let m4a = formats.iter().filter(|f| has_audio(f) && !has_video(f) && f["ext"] == "m4a").max_by(|a, b| num(&a["abr"]).total_cmp(&num(&b["abr"])));
    let mut out = vec![];
    let mut heights: Vec<u64> = formats.iter().filter(|f| has_video(f)).filter_map(|f| f["height"].as_u64()).collect();
    heights.sort_unstable_by(|a, b| b.cmp(a));
    heights.dedup();
    let mut seen = vec![];
    for h in heights {
        // (each step of the usual ladder once: 1080p, 720p…; odd heights go with the step they reach)
        let level = LEVELS.iter().copied().find(|l| h >= *l).unwrap_or(h);
        if seen.contains(&level) {
            continue;
        }
        seen.push(level);
        let at: Vec<&Value> = formats.iter().filter(|f| has_video(f) && f["height"].as_u64() == Some(h)).collect();
        let avc = at.iter().filter(|f| f["vcodec"].as_str().unwrap_or("").starts_with("avc1")).max_by(|a, b| num(&a["tbr"]).total_cmp(&num(&b["tbr"]))).copied();
        let best = at.iter().max_by(|a, b| num(&a["tbr"]).total_cmp(&num(&b["tbr"]))).copied();
        let Some(v) = avc.or(best) else { continue };
        let muxed = has_audio(v);
        let sound = if muxed { None } else { if avc.is_some() { m4a.or(audio) } else { audio } };
        // (a part of unknown size: the whole is not known either)
        let (vs, ss) = (size_of(v), sound.map(size_of).unwrap_or(0.0));
        let size = if vs > 0.0 && (sound.is_none() || ss > 0.0) { vs + ss } else { 0.0 };
        let sel = if avc.is_some() {
            format!("bv*[height={h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height={h}]+ba/b[height={h}]/b")
        } else {
            format!("bv*[height={h}]+ba/b[height={h}]/b")
        };
        out.push(json!({
            "key": sel, "kind": "video", "label": format!("{level}p"), "height": h, "width": v["width"],
            "fps": v["fps"], "vcodec": v["vcodec"].as_str().unwrap_or("").split('.').next().unwrap_or(""),
            "ext": "mp4", "size": size.round(),
        }));
    }
    if let Some(a) = audio.or(m4a) {
        out.push(json!({ "key": "ba[ext=m4a]/ba", "kind": "audio", "label": "M4A", "ext": "m4a", "abr": a["abr"], "size": size_of(m4a.unwrap_or(a)).round() }));
        out.push(json!({ "key": "ba/b", "kind": "mp3", "label": "MP3", "ext": "mp3", "abr": a["abr"], "size": 0 }));
    }
    if out.is_empty() {
        // (a site that gives one file)
        out.push(json!({ "key": "b", "kind": "video", "label": info["ext"].as_str().unwrap_or("video").to_uppercase(), "ext": info["ext"], "height": info["height"], "size": size_of(info).round() }));
    }
    out
}

fn entry(info: &Value, index: usize) -> Value {
    let thumb = info["thumbnail"].as_str().map(String::from).or_else(|| info["thumbnails"].as_array().and_then(|t| t.last()).and_then(|t| t["url"].as_str()).map(String::from)).unwrap_or_default();
    json!({ "index": index, "title": info["title"], "thumb": thumb, "duration": info["duration"], "width": info["width"], "height": info["height"], "choices": choices(info) })
}

#[tauri::command]
pub async fn grab_info(app: AppHandle, url: String) -> R<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("Dán một đường link bắt đầu bằng https://".into());
        }
        let exe = ytdlp(&app)?;
        let a2 = app.clone();
        std::thread::spawn(move || update(&a2, false));
        let cookies = cookie_file(&app, &url);
        let mut c = command(&exe);
        c.args(["-J", "--no-warnings", "--ignore-config", "--no-playlist", "--playlist-items", "1:20"]);
        if let Some(f) = &cookies {
            c.arg("--cookies").arg(f);
        }
        let out = c.arg("--").arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped()).output().map_err(err)?;
        if let Some(f) = &cookies {
            let _ = std::fs::remove_file(f);
        }
        if !out.status.success() {
            let a3 = app.clone();
            std::thread::spawn(move || update(&a3, true));
            return Err(error_of(&String::from_utf8_lossy(&out.stderr)));
        }
        let info: Value = serde_json::from_slice(&out.stdout).map_err(|_| "yt-dlp trả về dữ liệu không đọc được".to_string())?;
        let entries: Vec<Value> = if info["_type"] == "playlist" {
            info["entries"].as_array().cloned().unwrap_or_default().iter().filter(|e| e.is_object()).enumerate().map(|(i, e)| entry(e, i + 1)).collect()
        } else {
            vec![entry(&info, 0)]
        };
        Ok(json!({
            "url": url,
            "site": info["extractor_key"].as_str().or(info["extractor"].as_str()).unwrap_or(""),
            "title": info["title"],
            "uploader": info["uploader"].as_str().or(info["channel"].as_str()).unwrap_or(""),
            "thumb": entries.first().map(|e| e["thumb"].clone()).unwrap_or(Value::Null),
            "entries": entries,
            "ffmpeg": ffmpeg_here(&app).is_some(),
        }))
    })
    .await
    .map_err(err)?
}

// ---------- downloading ----------
/// Starts a download in the background; its progress comes as `download` events (Tải xuống).
#[tauri::command]
pub fn grab_download(app: AppHandle, url: String, key: String, kind: String, index: Option<u32>, title: String) -> u32 {
    let id = crate::wv2::NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed);
    std::thread::spawn(move || {
        let dir = app.state::<App>().download_dir();
        let _ = std::fs::create_dir_all(&dir);
        let shown: String = title.chars().take(120).collect();
        let base = json!({ "id": id, "url": url, "path": dir.join(&shown).to_string_lossy(), "file": shown, "started": now_ms(), "private": false, "own": true, "grab": true });
        let mut job = Job { app: app.clone(), base, id, last: Instant::now() - Duration::from_secs(1) };
        job.emit("progressing", 0, -1, true);
        match run_download(&app, &mut job, &url, &key, &kind, index, &dir) {
            Ok((path, bytes)) => {
                job.base["path"] = json!(path.to_string_lossy());
                job.base["file"] = json!(path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
                job.emit("completed", bytes, bytes as i64, true);
            }
            Err(e) => {
                job.base["error"] = json!(e);
                job.emit(if is_cancelled(id) { "cancelled" } else { "interrupted" }, 0, -1, true);
            }
        }
    });
    id
}

fn run_download(app: &AppHandle, job: &mut Job, url: &str, key: &str, kind: &str, index: Option<u32>, dir: &Path) -> R<(PathBuf, u64)> {
    let exe = ytdlp(app)?;
    // (a video with its sound apart, and an MP3, need FFmpeg)
    let ff = ffmpeg(app).ok();
    let cookies = cookie_file(app, url);
    let mut c = command(&exe);
    c.args(["--ignore-config", "--no-warnings", "--newline", "--progress", "--no-mtime", "-f", key, "-P"]).arg(dir);
    c.args(["-o", "%(title).120B [%(id)s].%(ext)s", "--progress-template", "download:UNKP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s", "--print", "before_dl:UNKI %(id)s", "--print", "after_move:UNKF %(filepath)s"]);
    match index {
        Some(i) if i > 0 => {
            c.args(["--yes-playlist", "--playlist-items"]).arg(i.to_string());
        }
        _ => {
            c.arg("--no-playlist");
        }
    }
    if kind == "mp3" {
        c.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
    } else if kind == "video" {
        c.args(["--merge-output-format", "mp4"]);
    }
    if let Some(f) = &ff {
        c.arg("--ffmpeg-location").arg(f);
    }
    if let Some(f) = &cookies {
        c.arg("--cookies").arg(f);
    }
    let mut child = c.arg("--").arg(url).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(err)?;
    let stderr = child.stderr.take();
    let err_text = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s);
        }
        s
    });
    let mut path: Option<PathBuf> = None;
    let mut vid: Option<String> = None;
    let started = std::time::SystemTime::now();
    // (a video and its sound come one after the other: the bytes of the parts done are kept)
    let (mut done_parts, mut last_got, mut last_total) = (0u64, 0u64, 0u64);
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            if is_cancelled(job.id) {
                let _ = child.kill();
                break;
            }
            if let Some(rest) = line.strip_prefix("UNKP ") {
                let p: Vec<u64> = rest.split_whitespace().map(|x| x.parse::<f64>().map(|v| v as u64).unwrap_or(0)).collect();
                let got = p.first().copied().unwrap_or(0);
                let total = p.get(1).copied().filter(|t| *t > 0).or(p.get(2).copied()).unwrap_or(0);
                if got < last_got {
                    done_parts += last_total.max(last_got);
                }
                last_got = got;
                last_total = total;
                job.emit("progressing", done_parts + got, if total > 0 { (done_parts + total) as i64 } else { -1 }, false);
            } else if let Some(i) = line.strip_prefix("UNKI ") {
                vid = Some(i.trim().to_string());
            } else if let Some(f) = line.strip_prefix("UNKF ") {
                path = Some(PathBuf::from(f.trim()));
            }
        }
    }
    let status = child.wait().map_err(err)?;
    let stderr = err_text.join().unwrap_or_default();
    if let Some(f) = &cookies {
        let _ = std::fs::remove_file(f);
    }
    if is_cancelled(job.id) || !status.success() {
        // (what yt-dlp left of it: its parts, written since it started)
        if let Some(v) = vid.filter(|v| !v.is_empty()) {
            let mark = format!("[{v}]");
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    let fresh = e.metadata().and_then(|m| m.modified()).map(|t| t >= started).unwrap_or(false);
                    if fresh && n.contains(&mark) && (n.ends_with(".part") || n.ends_with(".ytdl") || n.contains(&format!("{mark}.f")) || n.ends_with(".temp.mp4")) {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
        }
    }
    if is_cancelled(job.id) {
        return Err("cancelled".into());
    }
    if !status.success() {
        let a = app.clone();
        std::thread::spawn(move || update(&a, true));
        return Err(error_of(&stderr));
    }
    let path = path.filter(|p| p.exists()).ok_or_else(|| "Không tìm thấy tệp đã tải".to_string())?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok((path, bytes))
}
