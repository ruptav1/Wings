//! Dọn rác (Settings → Quyền riêng tư → Dọn rác): what can go without losing anything of the user's.
//! - the pages' cache (WebView2 empties it itself, so files in use are handled), the graphics
//!   shader caches and crash reports;
//! - the browser's own leftovers: unfinished downloads (wallpapers, Chromium's .crdownload);
//! - Windows' temp folder (the user's %TEMP%): files not changed for a week; a file in use stays.
//! History, sign-ins, cookies, wallpapers and downloads are not touched. Sizes are measured when
//! Settings shows the section; nothing goes until the user presses for it.
use crate::state::App;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use crate::tauri::{AppHandle, Emitter, Manager};

const WEEK: Duration = Duration::from_secs(7 * 24 * 3600);

/// (bytes, files) under `dir` whose files pass `keep`; recursion follows no links.
fn measure(dir: &Path, filter: &dyn Fn(&fs::Metadata) -> bool) -> (u64, u64) {
    let mut bytes = 0;
    let mut files = 0;
    let Ok(rd) = fs::read_dir(dir) else { return (0, 0) };
    for e in rd.flatten() {
        let Ok(md) = e.metadata() else { continue };
        if md.file_type().is_symlink() {
            continue;
        }
        if md.is_dir() {
            let (b, f) = measure(&e.path(), filter);
            bytes += b;
            files += f;
        } else if filter(&md) {
            bytes += md.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// Deletes the files under `dir` that pass `filter`; returns the bytes freed. With `dirs`, a folder
/// left empty goes too when it passes `filter` itself (a program's fresh empty folder stays).
fn sweep(dir: &Path, filter: &dyn Fn(&fs::Metadata) -> bool, dirs: bool) -> u64 {
    let mut freed = 0;
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    for e in rd.flatten() {
        let Ok(md) = e.metadata() else { continue };
        if md.file_type().is_symlink() {
            continue;
        }
        let p = e.path();
        if md.is_dir() {
            freed += sweep(&p, filter, dirs);
            if dirs && filter(&md) {
                let _ = fs::remove_dir(&p); // (only when it is now empty)
            }
        } else if filter(&md) && fs::remove_file(&p).is_ok() {
            freed += md.len();
        }
    }
    freed
}

fn all(_: &fs::Metadata) -> bool {
    true
}
fn week_old(md: &fs::Metadata) -> bool {
    md.modified().ok().and_then(|t| SystemTime::now().duration_since(t).ok()).map(|d| d > WEEK).unwrap_or(false)
}

/// Gecko's profile (the browser's own data is its "unk" folder).
fn gecko(app: &AppHandle) -> PathBuf {
    let p = app.state::<App>().profile.clone();
    p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
}

/// The pages' cache (emptied by WebView2) and the shader caches beside it.
fn cache_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let g = gecko(app);
    vec![g.join("cache2"), g.join("shader-cache"), g.join("jumpListCache"), g.join("thumbnails")]
}

fn leftovers(app: &AppHandle) -> Vec<PathBuf> {
    let st = app.state::<App>();
    let mut out = vec![];
    for dir in [st.profile.join("wallpapers"), st.download_dir()] {
        if let Ok(rd) = fs::read_dir(&dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_lowercase();
                let old = e.metadata().map(|m| m.modified().ok().and_then(|t| SystemTime::now().duration_since(t).ok()).map(|d| d > Duration::from_secs(3600)).unwrap_or(false)).unwrap_or(false);
                if old && (n.ends_with(".part") || n.ends_with(".crdownload")) {
                    out.push(e.path());
                }
            }
        }
    }
    out
}

fn temp() -> PathBuf {
    std::env::temp_dir()
}

pub async fn cleaner_scan(app: AppHandle) -> Value {
    crate::tauri::spawn_blocking(move || {
        let cache = cache_dirs(&app).iter().map(|d| measure(d, &all)).fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
        let crash = measure(&gecko(&app).join("minidumps"), &all);
        let left = leftovers(&app).iter().filter_map(|p| fs::metadata(p).ok()).fold((0, 0), |a, m| (a.0 + m.len(), a.1 + 1));
        let tmp = measure(&temp(), &week_old);
        json!({
            "cache": { "bytes": cache.0, "files": cache.1 },
            "crash": { "bytes": crash.0, "files": crash.1 },
            "leftovers": { "bytes": left.0, "files": left.1 },
            "temp": { "bytes": tmp.0, "files": tmp.1, "path": temp().to_string_lossy() },
        })
    })
    .await
    .unwrap_or(Value::Null)
}

/// Cleans the chosen parts ("cache", "crash", "leftovers", "temp"); returns the bytes freed by those
/// cleaned here (the cache is emptied by WebView2 itself, a moment later).
pub async fn cleaner_run(app: AppHandle, parts: Vec<String>) -> Value {
    crate::tauri::spawn_blocking(move || {
        let mut freed = 0u64;
        if parts.iter().any(|p| p == "cache") {
            // (the shader caches: what the GPU process does not hold open)
            let g = gecko(&app);
            for d in [g.join("shader-cache"), g.join("jumpListCache"), g.join("thumbnails")] {
                freed += sweep(&d, &all, false);
            }
        }
        if parts.iter().any(|p| p == "crash") {
            freed += sweep(&gecko(&app).join("minidumps"), &all, false);
        }
        if parts.iter().any(|p| p == "leftovers") {
            for p in leftovers(&app) {
                let n = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                if fs::remove_file(&p).is_ok() {
                    freed += n;
                }
            }
        }
        if parts.iter().any(|p| p == "temp") {
            freed += sweep(&temp(), &week_old, true);
        }
        json!({ "freed": freed })
    })
    .await
    .unwrap_or(Value::Null)
}
