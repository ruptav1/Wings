//! unk:// (http://unk.localhost/ in WebView2): the user's own files kept in the profile, such as
//! wallpapers and wallpaper videos. Byte ranges are served, so a long video plays and seeks without being
//! read whole into memory.
use crate::state::App;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
};
use tauri::{
    http::{header, Request, Response, StatusCode},
    Manager, Runtime, UriSchemeContext, UriSchemeResponder,
};

const MAX_CHUNK: u64 = 4 * 1024 * 1024;

fn mime(path: &PathBuf) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("bmp") => "image/bmp",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap()
}

pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let profile = ctx.app_handle().state::<App>().profile.clone();
    std::thread::spawn(move || responder.respond(serve(&profile, &req)));
}

fn serve(profile: &std::path::Path, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // /wall/<file> and /wall/thumbs/<file>
    let path = req.uri().path().trim_start_matches('/');
    let mut parts = path.splitn(2, '/');
    let (Some("wall"), Some(name)) = (parts.next(), parts.next()) else { return not_found() };
    let name = percent_decode(name);
    let (sub, name) = match name.strip_prefix("thumbs/") {
        Some(n) => ("thumbs", n.to_string()),
        None => ("", name),
    };
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        return not_found();
    }
    let file_path = profile.join("wallpapers").join(sub).join(&name);
    let Ok(mut f) = File::open(&file_path) else { return not_found() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    // (what the file holds, whatever its name says)
    let ty = crate::walls::sniff_file(&file_path).map(|(_, ext)| mime(&PathBuf::from(format!("x.{ext}")))).unwrap_or_else(|| mime(&file_path));

    let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes="));
    if let Some(r) = range {
        let mut it = r.splitn(2, '-');
        let start: u64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let end: u64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(len.saturating_sub(1)).min(len.saturating_sub(1));
        let end = end.min(start + MAX_CHUNK - 1);
        if start >= len {
            return Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE).header(header::CONTENT_RANGE, format!("bytes */{len}")).body(Vec::new()).unwrap();
        }
        let mut buf = vec![0u8; (end - start + 1) as usize];
        if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
            return not_found();
        }
        return Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, ty)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(buf)
            .unwrap();
    }
    let mut buf = Vec::with_capacity(len as usize);
    if f.read_to_end(&mut buf).is_err() {
        return not_found();
    }
    Response::builder()
        .header(header::CONTENT_TYPE, ty)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "max-age=31536000")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(buf)
        .unwrap()
}

fn percent_decode(s: &str) -> String {
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
