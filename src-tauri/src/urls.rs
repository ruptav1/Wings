//! The browser's own pages are written unk://<name>/#hash in the address bar and served from the app's
//! files (http://tauri.localhost/pages/<name>/index.html#hash in WebView2).
pub const APP_ORIGIN: &str = "http://tauri.localhost";
pub const PAGES: &[&str] = &["newtab", "settings", "history", "bookmarks", "downloads", "taskmgr", "store"];

/// unk://settings/#about -> http://tauri.localhost/pages/settings/index.html#about
pub fn to_real(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("unk://") {
        let (name, tail) = match rest.find(|c| c == '/' || c == '#' || c == '?') {
            Some(i) => (&rest[..i], rest[i..].trim_start_matches('/')),
            None => (rest, ""),
        };
        let name = if PAGES.contains(&name) { name } else { "newtab" };
        return format!("{APP_ORIGIN}/pages/{name}/index.html{tail}");
    }
    url.to_string()
}

/// http://tauri.localhost/pages/settings/index.html#about -> unk://settings/#about
pub fn to_display(url: &str) -> String {
    if let Some(rest) = url.strip_prefix(APP_ORIGIN).and_then(|r| r.strip_prefix("/pages/")) {
        if let Some(i) = rest.find('/') {
            let name = &rest[..i];
            let tail = rest[i + 1..].trim_start_matches("index.html");
            return if tail.is_empty() { format!("unk://{name}") } else { format!("unk://{name}/{tail}") };
        }
    }
    url.to_string()
}

pub fn is_internal_real(url: &str) -> bool {
    url.starts_with(APP_ORIGIN) || url.starts_with("http://unk.localhost")
}

pub fn host_of(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or("");
    let host = rest.split(|c| c == '/' || c == '?' || c == '#').next().unwrap_or("");
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    host.trim_start_matches("www.").to_lowercase()
}
