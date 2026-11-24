//! Pixiv for Tải từ đường dẫn (from TyranWeb; yt-dlp does not read it), with the user's own Pixiv login
//! in the browser (its cookies, handed in by the Gecko side): a work's animation (ugoira: its frames
//! and their timing, made into an .mp4 or a .gif by FFmpeg) or its pictures (the originals, each page
//! of it). Pixiv's images only load with Pixiv as referrer.
use crate::media::{is_cancelled, Job};
use crate::state::App;
use crate::store::now_ms;
use crate::tauri::{AppHandle, Manager};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const REF: &str = "https://www.pixiv.net/";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
type R<T> = Result<T, String>;

pub fn id_of(url: &str) -> Option<String> {
    let low = url.to_lowercase();
    if !low.contains("pixiv.net/") {
        return None;
    }
    let digits = |s: &str| s.chars().take_while(|c| c.is_ascii_digit()).collect::<String>();
    if let Some(i) = low.find("/artworks/") {
        let d = digits(&low[i + 10..]);
        return (!d.is_empty()).then_some(d);
    }
    if let Some(i) = low.find("illust_id=") {
        let d = digits(&low[i + 10..]);
        return (!d.is_empty()).then_some(d);
    }
    None
}

/// The Cookie header for pixiv.net, from the browser's cookies (a Netscape cookie file's text).
fn cookie_header(netscape: &str) -> String {
    netscape
        .lines()
        .filter(|l| !l.trim().is_empty() && (!l.starts_with('#') || l.starts_with("#HttpOnly_")))
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            (f.len() >= 7 && f[0].trim_start_matches("#HttpOnly_").ends_with("pixiv.net")).then(|| format!("{}={}", f[5], f[6]))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(60)).user_agent(UA).build()
}

fn get(url: &str, cookies: &str) -> R<ureq::Response> {
    let mut r = agent().get(url).set("Referer", REF);
    if !cookies.is_empty() {
        r = r.set("Cookie", cookies);
    }
    r.call().map_err(|e| match e {
        ureq::Error::Status(c, _) => format!("HTTP {c}"),
        e => e.to_string(),
    })
}

fn api(url: &str, cookies: &str) -> R<Value> {
    let text = get(url, cookies)?.into_string().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|_| "Pixiv trả về dữ liệu không đọc được".to_string())?;
    if v["error"].as_bool() == Some(true) {
        return Err(v["message"].as_str().unwrap_or("Pixiv").to_string());
    }
    Ok(v["body"].clone())
}

fn size_of(url: &str, cookies: &str) -> u64 {
    let mut r = agent().head(url).set("Referer", REF);
    if !cookies.is_empty() {
        r = r.set("Cookie", cookies);
    }
    r.call().ok().and_then(|r| r.header("content-length").and_then(|v| v.parse().ok())).unwrap_or(0)
}

/// → { url, site, title, uploader, entries: [{ index, title, thumb, duration, width, height, choices }] }
pub fn analyze(url: &str, netscape: &str) -> R<Value> {
    let id = id_of(url).ok_or("Không phải link tác phẩm Pixiv")?;
    let cookies = cookie_header(netscape);
    let w = api(&format!("https://www.pixiv.net/ajax/illust/{id}"), &cookies).map_err(|_| {
        if cookies.contains("PHPSESSID=") && cookies.split("PHPSESSID=").nth(1).is_some_and(|v| v.split(';').next().unwrap_or("").contains('_')) {
            "Tác phẩm này không còn hoặc bạn không xem được".to_string()
        } else {
            "Cần đăng nhập Pixiv trong trình duyệt trước".to_string()
        }
    })?;
    let title = w["illustTitle"].as_str().or(w["title"].as_str()).map(String::from).unwrap_or_else(|| format!("pixiv {id}"));
    let (width, height) = (w["width"].as_u64().unwrap_or(0), w["height"].as_u64().unwrap_or(0));
    let base = |entries: Vec<Value>| json!({ "url": url, "site": "Pixiv", "title": title, "uploader": w["userName"].as_str().unwrap_or(""), "id": id, "entries": entries, "ffmpeg": true });
    if w["illustType"].as_u64() == Some(2) {
        let m = api(&format!("https://www.pixiv.net/ajax/illust/{id}/ugoira_meta"), &cookies)?;
        let frames = m["frames"].as_array().cloned().unwrap_or_default();
        if frames.is_empty() {
            return Err("Tác phẩm này không có ảnh động".into());
        }
        let duration: f64 = frames.iter().map(|f| f["delay"].as_f64().unwrap_or(100.0)).sum::<f64>() / 1000.0;
        let fps = frames.len() as f64 / duration.max(0.01);
        let small = (600.0 / width.max(height).max(1) as f64).min(1.0);
        let (full, light) = (m["originalSrc"].as_str().unwrap_or(""), m["src"].as_str().unwrap_or(""));
        let thumb = w["urls"]["regular"].as_str().or(w["urls"]["small"].as_str()).unwrap_or("");
        return Ok(base(vec![json!({
            "index": 1, "title": title, "thumb": thumb, "duration": duration, "width": width, "height": height,
            "choices": [
                { "key": "mp4", "kind": "video", "label": format!("{height}p"), "ext": "mp4", "width": width, "height": height, "fps": fps, "size": size_of(if full.is_empty() { light } else { full }, &cookies) },
                { "key": "gif", "kind": "gif", "label": "GIF", "ext": "gif", "width": (width as f64 * small).round(), "height": (height as f64 * small).round(), "fps": fps, "size": size_of(if light.is_empty() { full } else { light }, &cookies) },
            ],
        })]));
    }
    let pages = api(&format!("https://www.pixiv.net/ajax/illust/{id}/pages"), &cookies)?.as_array().cloned().unwrap_or_default();
    let n = pages.len().min(30);
    let entries = pages
        .iter()
        .take(30)
        .enumerate()
        .map(|(i, p)| {
            let original = p["urls"]["original"].as_str().unwrap_or("");
            let ext = original.rsplit('.').next().unwrap_or("jpg").to_lowercase();
            json!({
                "index": i + 1,
                "title": if n > 1 { format!("{title} ({}/{n})", i + 1) } else { title.clone() },
                "thumb": p["urls"]["small"].as_str().or(p["urls"]["regular"].as_str()).unwrap_or(""),
                "width": p["width"], "height": p["height"],
                "choices": [{ "key": "img", "kind": "image", "label": format!("{}×{}", p["width"].as_u64().unwrap_or(0), p["height"].as_u64().unwrap_or(0)), "ext": ext, "size": if i < 6 { size_of(original, &cookies) } else { 0 } }],
            })
        })
        .collect();
    Ok(base(entries))
}

fn safe(s: &str) -> String {
    let t: String = s.chars().map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { '_' } else { c }).take(120).collect();
    let t = t.trim().trim_end_matches('.').to_string();
    if t.is_empty() { "pixiv".into() } else { t }
}

fn unique(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (1..1000).map(|i| dir.join(format!("{stem} ({i}).{ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

/// Downloads one choice of an entry (read again from Pixiv); its progress comes as `download` events.
pub fn download(app: AppHandle, url: String, key: String, index: Option<u32>, netscape: String) -> u32 {
    let id = crate::NEXT_DOWNLOAD.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    std::thread::spawn(move || {
        let dir = app.state::<App>().download_dir();
        let _ = fs::create_dir_all(&dir);
        let work = id_of(&url).unwrap_or_default();
        let base = json!({ "id": id, "url": format!("https://www.pixiv.net/artworks/{work}"), "path": "", "file": format!("pixiv {work}"), "started": now_ms(), "private": false, "own": true, "grab": true });
        let mut job = Job { app: app.clone(), base, id, last: Instant::now() - Duration::from_secs(1) };
        job.emit("progressing", 0, -1, true);
        match run(&app, &mut job, &url, &key, index.unwrap_or(1).max(1) as usize, &netscape, &dir) {
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

fn fetch_to(job: &mut Job, src: &str, cookies: &str, out: &Path, share: f64) -> R<u64> {
    let res = get(src, cookies)?;
    let total: u64 = res.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut reader = res.into_reader();
    let mut f = fs::File::create(out).map_err(|e| e.to_string())?;
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
        job.emit("progressing", (got as f64 * share) as u64, if total > 0 { total as i64 } else { -1 }, false);
    }
    Ok(got)
}

fn run(app: &AppHandle, job: &mut Job, url: &str, key: &str, index: usize, netscape: &str, dir: &Path) -> R<(PathBuf, u64)> {
    let info = analyze(url, netscape)?;
    let cookies = cookie_header(netscape);
    let work = info["id"].as_str().unwrap_or("").to_string();
    let title = info["title"].as_str().unwrap_or("pixiv").to_string();
    if key == "img" {
        let pages = api(&format!("https://www.pixiv.net/ajax/illust/{work}/pages"), &cookies)?.as_array().cloned().unwrap_or_default();
        let p = pages.get(index - 1).ok_or("Không có trang này")?;
        let src = p["urls"]["original"].as_str().ok_or("Không có ảnh gốc")?;
        let name = src.rsplit('/').next().unwrap_or("pixiv.jpg");
        let path = unique(dir, name);
        job.base["path"] = json!(path.to_string_lossy());
        job.base["file"] = json!(name);
        let part = path.with_extension("part");
        let r = fetch_to(job, src, &cookies, &part, 1.0);
        match r {
            Ok(n) => {
                fs::rename(&part, &path).map_err(|e| e.to_string())?;
                Ok((path, n))
            }
            Err(e) => {
                let _ = fs::remove_file(&part);
                Err(e)
            }
        }
    } else {
        // an animation: its frames' zip, put together by FFmpeg
        let m = api(&format!("https://www.pixiv.net/ajax/illust/{work}/ugoira_meta"), &cookies)?;
        let gif = key == "gif";
        let src = if gif { m["src"].as_str().or(m["originalSrc"].as_str()) } else { m["originalSrc"].as_str().or(m["src"].as_str()) }.ok_or("Không có ảnh động")?;
        let ext = if gif { "gif" } else { "mp4" };
        let path = unique(dir, &format!("{} [pixiv {work}].{ext}", safe(&title)));
        job.base["path"] = json!(path.to_string_lossy());
        job.base["file"] = json!(path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        let tmp = std::env::temp_dir().join(format!("unknowweb-ugoira-{}", job.id));
        let _ = fs::create_dir_all(&tmp);
        let result = (|| -> R<(PathBuf, u64)> {
            let zip_path = tmp.join("frames.zip");
            fetch_to(job, src, &cookies, &zip_path, 0.9)?;
            let mut zip = zip::ZipArchive::new(fs::File::open(&zip_path).map_err(|e| e.to_string())?).map_err(|_| "Tệp khung hình hỏng".to_string())?;
            for i in 0..zip.len() {
                let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
                let name = Path::new(f.name()).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
                    continue;
                }
                let mut out = fs::File::create(tmp.join(&name)).map_err(|e| e.to_string())?;
                std::io::copy(&mut f, &mut out).map_err(|e| e.to_string())?;
            }
            // (each frame for its own time; the last one listed again, as FFmpeg's concat reader wants)
            let mut list = vec!["ffconcat version 1.0".to_string()];
            let mut last = String::new();
            for f in m["frames"].as_array().cloned().unwrap_or_default() {
                let name = f["file"].as_str().unwrap_or("");
                if name.is_empty() || !tmp.join(name).exists() {
                    continue;
                }
                list.push(format!("file '{name}'"));
                list.push(format!("duration {:.3}", f["delay"].as_f64().unwrap_or(100.0) / 1000.0));
                last = format!("file '{name}'");
            }
            if list.len() < 3 {
                return Err("Không có khung hình".into());
            }
            list.push(last);
            fs::write(tmp.join("list.txt"), list.join("\n") + "\n").map_err(|e| e.to_string())?;
            let ff = crate::grab::ffmpeg_for(app)?;
            let out = path.with_extension(format!("{ext}.part"));
            let filter = if gif { "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" } else { "pad=ceil(iw/2)*2:ceil(ih/2)*2" };
            let mut c = Command::new(ff);
            c.creation_flags(0x0800_0000).args(["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i"]).arg(tmp.join("list.txt")).args(["-vf", filter]);
            if gif {
                c.args(["-loop", "0", "-f", "gif"]);
            } else {
                c.args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-fps_mode", "vfr", "-f", "mp4"]);
            }
            let o = c.arg(&out).stdout(Stdio::null()).stderr(Stdio::piped()).output().map_err(|e| e.to_string())?;
            if !o.status.success() {
                let _ = fs::remove_file(&out);
                return Err(String::from_utf8_lossy(&o.stderr).trim().lines().last().unwrap_or("FFmpeg").to_string());
            }
            fs::rename(&out, &path).map_err(|e| e.to_string())?;
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            Ok((path.clone(), size))
        })();
        let _ = fs::remove_dir_all(&tmp);
        result
    }
}
