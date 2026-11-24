//! unkcore.dll: Unknow Web Browser's own back end, for its interface running on Mozilla's Gecko core.
//!
//! The interface (chrome://unknowweb/content/…) loads this library with js-ctypes and asks it what the
//! Tauri build's commands answered: settings, bookmarks, history, notes, the downloads list, the ad
//! blocker, wallpapers and their store, Tải từ đường dẫn (yt-dlp), Dọn rác, backups. Everything the
//! engine itself does (tabs, pages, cookies, the Gecko downloads) is the Gecko side's.
//!
//! - `unk_call`: answers at once (on the caller's thread);
//! - `unk_submit`: runs on a thread of its own, its answer comes later as a `__result` event;
//! - `unk_next`: the next event (what the commands "emit", in the Tauri build's shape), for the
//!   worker that waits on them;
//! - `unk_block`: the ad blocker's answer for one request (the network observer, on every request).
#![allow(clippy::missing_safety_doc)]
mod adblock;
mod anime;
mod apps;
mod cleaner;
mod commands2;
mod grab;
mod media;
mod paths;
mod perms;
mod pixiv;
mod procmem;
mod scan;
mod secret;
mod shields;
mod state;
mod store;
pub mod tauri;
mod tracking;
mod tyransync;
mod urls;
mod wallmore;
mod walls;
mod warp;

use serde_json::{json, Value};
use std::{
    ffi::{c_char, CStr, CString},
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
    sync::atomic::AtomicU32,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

pub const TITLE: &str = "Wings";

/// The downloads the core runs itself (videos, Tải từ đường dẫn): ids apart from Gecko's.
pub static NEXT_DOWNLOAD: AtomicU32 = AtomicU32::new(1_000_000);

/// A file name safe to keep in the profile and to put in a URL.
pub(crate) fn protocol_name(name: &str) -> String {
    let n: String = name.chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' }).collect();
    let n = n.trim_matches('.').to_string();
    if n.is_empty() { "file".into() } else { n }
}

type R<T> = Result<T, String>;

// ---------- arguments ----------
struct Args(Value);
impl Args {
    fn s(&self, k: &str) -> String {
        match &self.0[k] {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            v => v.to_string(),
        }
    }
    fn os(&self, k: &str) -> Option<String> {
        self.0[k].as_str().map(|s| s.to_string())
    }
    fn u64(&self, k: &str) -> Option<u64> {
        self.0[k].as_u64().or_else(|| self.0[k].as_f64().map(|f| f.max(0.0) as u64))
    }
    fn b(&self, k: &str) -> Option<bool> {
        self.0[k].as_bool()
    }
    fn v(&self, k: &str) -> Value {
        self.0[k].clone()
    }
}

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    let mut f = std::pin::pin!(f);
    let waker = std::task::Waker::noop();
    let mut cx = std::task::Context::from_waker(waker);
    loop {
        if let std::task::Poll::Ready(v) = f.as_mut().poll(&mut cx) {
            return v;
        }
        std::thread::yield_now();
    }
}

fn settings_changed(s: &Value) {
    let st = state::app();
    let was = st.flags.cookie_notices();
    st.flags.update(s);
    if st.flags.cookie_notices() != was {
        st.blocker.set_cookie_notices(st.flags.cookie_notices());
    }
    shields::privacy_changed(&s["privacy"]);
    let _ = AppHandle.emit("settings", s.clone());
}

fn ok<T: serde::Serialize>(v: T) -> R<Value> {
    Ok(serde_json::to_value(v).unwrap_or(Value::Null))
}

/// One command (what the Tauri build's `invoke` answered).
fn dispatch(cmd: &str, a: Args, bytes: Vec<u8>) -> R<Value> {
    let app = AppHandle;
    let st = state::app();
    match cmd {
        // settings
        "settings_get" => ok(st.store.settings()),
        "settings_set" => {
            let s = {
                let mut doc = st.store.settings.lock().unwrap();
                store::deep_merge(&mut doc.value, &a.v("patch"));
                doc.touch();
                doc.value.clone()
            };
            settings_changed(&s);
            ok(s)
        }
        "settings_reset" => {
            let defaults: Value = serde_json::from_str(include_str!("../defaults/settings.json")).unwrap();
            let s = {
                let mut doc = st.store.settings.lock().unwrap();
                match a.os("section") {
                    Some(sec) => doc.value[&sec] = defaults[&sec].clone(),
                    None => doc.value = defaults,
                }
                doc.touch();
                doc.value.clone()
            };
            settings_changed(&s);
            ok(s)
        }
        "engines_get" => ok(st.store.engines.clone()),
        // bookmarks, history, notes
        "bookmarks_get" => ok(st.store.bookmarks.lock().unwrap().value.clone()),
        "bookmarks_set" => {
            let v = a.v("value");
            {
                let mut doc = st.store.bookmarks.lock().unwrap();
                doc.value = v.clone();
                doc.touch();
            }
            let _ = app.emit("bookmarks", v);
            ok(())
        }
        "history_query" => ok(st.store.history.lock().unwrap().query(&a.s("text"), a.u64("before"), a.u64("limit").unwrap_or(200) as usize)),
        "history_suggest" => ok(st.store.history.lock().unwrap().suggest(&a.s("text"), 8)),
        "history_delete" => {
            st.store.history.lock().unwrap().delete_url(&a.s("url"));
            ok(())
        }
        "history_delete_range" => {
            let (from, to) = (a.u64("from").unwrap_or(0), a.u64("to").unwrap_or(u64::MAX));
            st.store.history.lock().unwrap().delete_range(from, to);
            if from == 0 {
                let mut doc = st.store.sessions.lock().unwrap();
                doc.value["closed"] = json!([]);
                doc.touch();
            }
            let _ = app.emit("history-cleared", json!({}));
            ok(())
        }
        "history_add" => {
            st.store.history.lock().unwrap().add(&a.s("url"), &a.s("title"), &a.s("favicon"));
            ok(())
        }
        "history_favicon" => {
            st.store.history.lock().unwrap().set_favicon(&a.s("url"), &a.s("favicon"));
            ok(())
        }
        "history_title" => {
            st.store.history.lock().unwrap().set_title(&a.s("url"), &a.s("title"));
            ok(())
        }
        "notes_get" => ok(st.store.notes.lock().unwrap().value.clone()),
        "notes_set" => {
            let mut doc = st.store.notes.lock().unwrap();
            doc.value["text"] = json!(a.s("text"));
            doc.value["updated"] = json!(store::now_ms());
            doc.touch();
            ok(())
        }
        // sessions (the Gecko side keeps the windows; their tabs are kept here)
        "session_take" => {
            // the windows of the last run, handed out once at start
            let restore = st.store.setting_str(&["general", "startup"]) == "restore";
            let mut doc = st.store.sessions.lock().unwrap();
            let list: Vec<Value> = match &doc.value["windows"] {
                Value::Object(m) => m.values().cloned().collect(),
                Value::Array(v) => v.clone(),
                _ => vec![],
            };
            doc.value["windows"] = json!({});
            doc.touch();
            let list: Vec<Value> = if restore { list.into_iter().filter(|s| s["tabs"].as_array().is_some_and(|t| !t.is_empty())).collect() } else { vec![] };
            ok(json!({ "windows": list, "closed": doc.value["closed"].clone() }))
        }
        "session_closed" => ok(st.store.sessions.lock().unwrap().value["closed"].clone()),
        "session_save" => {
            let label = a.s("win");
            let mut session = a.v("session");
            let mut doc = st.store.sessions.lock().unwrap();
            let bounds = a.v("bounds");
            let prev = doc.value["windows"][&label]["bounds"].clone();
            session["bounds"] = if bounds["maximized"].as_bool() == Some(true) {
                // (the size it comes back to: the one known before, else the one sent)
                let mut b = if prev.is_object() && prev["w"].is_number() { prev } else if bounds["w"].is_number() { bounds.clone() } else { json!({}) };
                b["maximized"] = json!(true);
                b
            } else {
                bounds
            };
            if !doc.value["windows"].is_object() {
                doc.value["windows"] = json!({});
            }
            doc.value["windows"][&label] = session;
            if !a.v("closed").is_null() {
                doc.value["closed"] = a.v("closed");
            }
            doc.touch();
            ok(())
        }
        "session_forget" => {
            // (a window closed while others stay open: kept among the recently closed windows)
            let mut doc = st.store.sessions.lock().unwrap();
            let gone = doc.value["windows"].as_object_mut().and_then(|m| m.remove(&a.s("win")));
            if let Some(mut w) = gone.filter(|w| w["tabs"].as_array().is_some_and(|t| !t.is_empty())) {
                w["closedAt"] = json!(store::now_ms());
                if !doc.value["closedWindows"].is_array() {
                    doc.value["closedWindows"] = json!([]);
                }
                let list = doc.value["closedWindows"].as_array_mut().unwrap();
                list.insert(0, w);
                list.truncate(10);
            }
            doc.touch();
            ok(())
        }
        "winhistory_list" => {
            let doc = st.store.sessions.lock().unwrap();
            ok(doc.value["closedWindows"].as_array().cloned().unwrap_or_default().into_iter().map(|w| json!({ "closedAt": w["closedAt"], "active": w["active"], "tabs": w["tabs"].as_array().map(|t| t.iter().map(|x| json!({ "url": x["url"], "title": x["title"], "favicon": x["favicon"] })).collect::<Vec<_>>()).unwrap_or_default() })).collect::<Vec<_>>())
        }
        "winhistory_take" => {
            let mut doc = st.store.sessions.lock().unwrap();
            let i = a.u64("index").unwrap_or(0) as usize;
            let w = doc.value["closedWindows"].as_array_mut().filter(|l| i < l.len()).map(|l| l.remove(i));
            doc.touch();
            ok(w)
        }
        "winhistory_clear" => {
            let mut doc = st.store.sessions.lock().unwrap();
            doc.value["closedWindows"] = json!([]);
            doc.touch();
            ok(())
        }
        // downloads (the finished ones are kept here)
        "downloads_list" => ok(st.store.downloads.lock().unwrap().value["items"].clone()),
        "download_record" => {
            let v = a.v("item");
            let mut doc = st.store.downloads.lock().unwrap();
            if let Some(items) = doc.value["items"].as_array_mut() {
                items.retain(|d| d["id"] != v["id"]);
                items.insert(0, v);
                items.truncate(500);
            }
            doc.touch();
            ok(())
        }
        "downloads_clear" => {
            let mut doc = st.store.downloads.lock().unwrap();
            // (ids: this browser's numbers, TyranWeb's "d…" strings)
            let key = |v: &Value| match v {
                Value::String(s) => s.clone(),
                v => v.to_string(),
            };
            let id = a.v("id");
            if id.is_null() {
                doc.value["items"] = json!([]);
            } else if let Some(items) = doc.value["items"].as_array_mut() {
                items.retain(|d| key(&d["id"]) != key(&id));
            }
            doc.touch();
            ok(())
        }
        "download_dir" => ok(st.download_dir().to_string_lossy().to_string()),
        // where the data lives (Settings → Giới thiệu → Thư mục dữ liệu): this browser's own folder,
        // or another (TyranWeb's), used in place or copied in, from the next start
        "data_folder_get" => {
            let cfg = store::read_json(&store::folder_file(&st.profile)).unwrap_or(Value::Null);
            ok(json!({
                "dir": st.store.data.to_string_lossy(),
                "own": store::own_folder(&st.profile).to_string_lossy(),
                "next": cfg["dir"].as_str().unwrap_or(""),
                "import": cfg["import"].as_str().unwrap_or(""),
                "tyran": store::tyran_folder().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                "files": store::DATA_FILES,
            }))
        }
        "data_folder_set" => {
            let file = store::folder_file(&st.profile);
            let mut cfg = store::read_json(&file).unwrap_or_else(|| json!({}));
            if !cfg.is_object() {
                cfg = json!({});
            }
            let dir = a.s("dir");
            match a.s("mode").as_str() {
                "use" | "import" => {
                    let p = PathBuf::from(&dir);
                    if !p.is_dir() {
                        return Err("Không thấy thư mục".into());
                    }
                    if !store::DATA_FILES.iter().any(|f| p.join(f).exists()) && a.s("mode") == "import" {
                        return Err("Thư mục này không có tệp dữ liệu nào".into());
                    }
                    if a.s("mode") == "use" {
                        cfg["dir"] = json!(dir);
                        cfg.as_object_mut().map(|o| o.remove("import"));
                    } else {
                        cfg["import"] = json!(dir);
                    }
                }
                "cancel" => {
                    cfg.as_object_mut().map(|o| o.remove("import"));
                    if st.store.data == store::own_folder(&st.profile) {
                        cfg.as_object_mut().map(|o| o.remove("dir"));
                    } else {
                        cfg["dir"] = json!(st.store.data.to_string_lossy());
                    }
                }
                _ => {
                    // (back to its own folder)
                    cfg.as_object_mut().map(|o| {
                        o.remove("dir");
                        o.remove("import");
                    });
                }
            }
            if cfg.as_object().is_some_and(|o| o.is_empty()) {
                let _ = std::fs::remove_file(&file);
            } else {
                store::write_json(&file, &cfg);
            }
            ok(())
        }
        "file_open" => std::process::Command::new("explorer").arg(a.s("path")).spawn().map(|_| Value::Null).map_err(|e| e.to_string()),
        "file_show" => std::process::Command::new("explorer").arg(format!("/select,{}", a.s("path"))).spawn().map(|_| Value::Null).map_err(|e| e.to_string()),
        "suggest_fetch" => {
            let url = a.s("url");
            if !url.starts_with("https://") {
                return Err("bad url".into());
            }
            let body = ureq::get(&url).timeout(Duration::from_secs(3)).call().map_err(|e| e.to_string())?.into_string().map_err(|e| e.to_string())?;
            serde_json::from_str(&body).map_err(|e| e.to_string())
        }
        // processes (the task manager)
        "proc_usage" => {
            let pids: Vec<u32> = a.0["pids"].as_array().map(|v| v.iter().filter_map(|p| p.as_u64().map(|p| p as u32)).collect()).unwrap_or_default();
            ok(pids
                .into_iter()
                .map(|pid| {
                    let u = procmem::usage(pid);
                    json!({ "pid": pid, "private": u.as_ref().map(|u| u.private_bytes).unwrap_or(0), "ws": u.as_ref().map(|u| u.working_set).unwrap_or(0), "cpu": u.as_ref().map(|u| u.cpu).unwrap_or(0.0) })
                })
                .collect::<Vec<_>>())
        }
        "process_kill" => {
            let pid = a.u64("pid").unwrap_or(0) as u32;
            ok(pid != std::process::id() && procmem::kill(pid))
        }
        // the ad blocker and Shields
        "adblock_status" => ok(json!({ "ready": st.blocker.ready() })),
        "adblock_update" => {
            st.blocker.rebuild(true);
            ok(json!({ "ready": st.blocker.ready() }))
        }
        "page_shields" => {
            // what a page gets before its own scripts: fingerprinting protection, the lists' scriptlets
            let url = a.s("url");
            let on = url.starts_with("http") && st.flags.adblock() && !shields::site_off(&app, &url);
            let (_, lets) = shields::scriptlets_for(&app, &url);
            ok(json!({ "fp": if shields::fp_on(&app, &url) { shields::fp_script(&app) } else { String::new() }, "fpOn": shields::fp_on(&app, &url), "lets": lets, "adblock": on }))
        }
        "page_cosmetic" => {
            let url = a.s("url");
            if !url.starts_with("http") || !st.flags.adblock() || shields::site_off(&app, &url) {
                return ok(Value::Null);
            }
            ok(st.blocker.cosmetic(&url).map(|(css, _)| css))
        }
        "nav_clean" => {
            // a tracker's bounce page skipped, tracking parameters taken off (Brave's lists)
            let (url, from) = (a.s("url"), a.s("from"));
            if !url.starts_with("http") || shields::site_off(&app, &url) {
                return ok(Value::Null);
            }
            let elsewhere = a.b("fromApp").unwrap_or(false) || !from.starts_with("http") || tracking::site(&from) != tracking::site(&url);
            let to = st.flags.debounce().then(|| tracking::debounce(&url)).flatten().or_else(|| (st.flags.strip_params() && elsewhere).then(|| tracking::strip(&url)).flatten());
            ok(to.filter(|t| *t != url))
        }
        "app_info" => ok(json!({
            "name": TITLE,
            "version": env!("CARGO_PKG_VERSION"),
            "profile": st.profile.to_string_lossy(),
            "downloads": st.download_dir().to_string_lossy(),
        })),
        // wallpapers and their store
        "wallpaper_list" => ok(walls::wallpaper_list(app)),
        "wallpaper_save" => walls::wallpaper_save(app, tauri::ipc::Request::new(bytes, &a.v("__headers"))),
        "wallpaper_delete" => {
            walls::wallpaper_delete(app, a.s("name"));
            ok(())
        }
        "wallpaper_meta" => ok(walls::wallpaper_meta(app, a.s("name"), a.v("patch"))),
        "wallpaper_thumb" => walls::wallpaper_thumb(app, tauri::ipc::Request::new(bytes, &a.v("__headers"))).map(Value::String),
        "wallpaper_from_url" => block_on(walls::wallpaper_from_url(app, a.s("url"), a.os("page"))).map(Value::String),
        "wallpaper_video_url" => block_on(walls::wallpaper_video_url(app, a.s("url"), a.s("id"))),
        "wallpaper_desktop" => block_on(walls::wallpaper_desktop(app)),
        "wall_search" => block_on(walls::wall_search(a.s("query"), a.u64("page").map(|p| p as u32), a.os("resolution"), a.os("sorting"), a.os("category"), a.b("preAi"))),
        "wall_get" => block_on(walls::wall_get(app, a.s("id"), a.b("apply"))),
        "store_page" => block_on(walls::store_page(a.s("url"))),
        "store_download" => block_on(walls::store_download(app, a.v("item"))),
        "store_cancel" => {
            walls::store_cancel(a.s("id"));
            ok(())
        }
        "wall_dir" => ok(walls::dir(&app).to_string_lossy().to_string()),
        // site permissions
        "perm_set" => ok(perms::perm_set(app, a.s("origin"), a.s("kind"), a.s("value"))),
        "perm_save" => {
            perms::save(&app, &a.s("origin"), &a.s("kind"), &a.s("value"));
            ok(())
        }
        // Dọn rác
        "cleaner_scan" => ok(block_on(cleaner::cleaner_scan(app))),
        "cleaner_run" => ok(block_on(cleaner::cleaner_run(app, serde_json::from_value(a.v("parts")).unwrap_or_default()))),
        // Tải từ đường dẫn, videos
        "grab_tools" => ok(grab::grab_tools(app)),
        "grab_info" => block_on(grab::grab_info(app, a.s("url"), a.s("cookies"))),
        "grab_download" => ok(grab::grab_download(app, a.s("url"), a.s("key"), a.s("kind"), a.u64("index").map(|i| i as u32), a.s("title"), a.s("cookies"))),
        "media_start" => ok(commands2::media_start(app, a.s("url"), a.s("kind"), a.s("title"), a.s("referer"), a.s("cookies"))),
        "media_cancel" => {
            commands2::media_cancel(a.u64("id").unwrap_or(0) as u32);
            ok(())
        }
        // backups, updates
        "backup_export" => ok(commands2::backup_export(app)),
        "backup_import" => commands2::backup_import(app, a.v("data")).map(|_| Value::Null),
        "update_check" => block_on(commands2::update_check(app)),
        // Kiểm tra tệp tải về (scan.rs)
        "scan_add" => {
            scan::add(a.v("item"));
            ok(())
        }
        "scan_get" => ok(scan::details(&a.s("id"))),
        "scan_recheck" => ok(scan::recheck(&a.s("id"))),
        "scan_quarantine" => ok(scan::quarantine(&a.s("id"))),
        "scan_may_open" => ok(scan::may_open(&a.s("path"))),
        "scanhistory_list" => ok(scan::history_list(&a.s("text"))),
        "scanhistory_remove" => {
            scan::history_remove(&a.s("id"));
            ok(())
        }
        "scanhistory_clear" => {
            scan::history_clear();
            ok(())
        }
        "vt_status" => ok(json!({ "hasKey": scan::has_key() })),
        "vt_set_key" => ok(scan::set_key(&a.s("key"))),
        "vt_clear_key" => {
            scan::clear_key();
            ok(())
        }
        // Ứng dụng trên máy (apps.rs)
        // TyranWeb 1.8.0+: its data offered once, and from Settings (tyransync.rs)
        "tyran_sync_status" => ok(tyransync::status(&st.profile, &st.store.data, a.b("claim").unwrap_or(false))),
        "tyran_sync_answer" => ok(tyransync::answer(&st.profile, a.b("yes").unwrap_or(false))),
        "tyran_sync_start" => tyransync::start(&st.profile, &st.store.data),
        "apps_list" => ok(apps::list(a.b("fresh").unwrap_or(false))),
        "apps_launch" => apps::launch(&a.s("id")).map(|_| Value::Null),
        // Cloudflare WARP (warp.rs)
        "warp_state" => ok(warp::state()),
        "warp_sync" => ok(warp::sync(a.b("on").unwrap_or(false))),
        "warp_action" => warp::action(&a.s("what")),
        // more of the wallpapers (wallmore.rs): many at once, linked folders, music, web wallpapers
        "wallpaper_add_paths" => ok(wallmore::add_paths(serde_json::from_value(a.v("paths")).unwrap_or_default())),
        "wallpaper_link_folder" => wallmore::link_folder(&a.s("path")),
        "wallpaper_unlink_folder" => {
            wallmore::unlink_folder(&a.s("id"));
            ok(())
        }
        "wallpaper_folders" => ok(json!({ "folders": wallmore::folders(), "dir": walls::dir(&app).to_string_lossy() })),
        "wallpaper_open_folder" => std::process::Command::new("explorer").arg(walls::dir(&app)).spawn().map(|_| Value::Null).map_err(|e| e.to_string()),
        "music_add" => ok(wallmore::music_add(serde_json::from_value(a.v("paths")).unwrap_or_default())),
        "music_link" => wallmore::music_link(&a.s("url")),
        "web_import" => wallmore::web_import(&a.s("path")),
        "web_list" => ok(wallmore::web_list()),
        "web_remove" => {
            wallmore::web_remove(&a.s("id"));
            ok(())
        }
        "specials_search" => wallmore::specials_search(&a.s("q"), a.u64("page").unwrap_or(1) as u32),
        "specials_inspect" => wallmore::specials_inspect(&a.s("full"), &a.s("branch")),
        "specials_install" => wallmore::specials_install(a.v("item")),
        "specials_cancel" => {
            wallmore::specials_cancel(&a.s("id"));
            ok(())
        }
        // Anime hôm nay (anime.rs)
        "anime_today" => anime::today_pick(&a.s("genre")),
        "save_all" => {
            st.store.save_all();
            ok(())
        }
        _ => Err(format!("unknown command: {cmd}")),
    }
}

// ---------- the C interface ----------
unsafe fn text(p: *const c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    CStr::from_ptr(p).to_string_lossy().into_owned()
}

fn out(s: String) -> *mut c_char {
    CString::new(s.replace('\0', "")).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
}

fn run(cmd: &str, args: &str, mut bytes: Vec<u8>) -> Value {
    let a = Args(serde_json::from_str(args).unwrap_or(Value::Null));
    // (a file's bytes handed over as a temporary file)
    if let Some(f) = a.0["__bytesFile"].as_str() {
        bytes = std::fs::read(f).unwrap_or_default();
        let _ = std::fs::remove_file(f);
    }
    match catch_unwind(AssertUnwindSafe(|| dispatch(cmd, a, bytes))) {
        Ok(Ok(v)) => json!({ "ok": v }),
        Ok(Err(e)) => json!({ "err": e }),
        Err(_) => json!({ "err": format!("{cmd} failed") }),
    }
}

unsafe fn bytes_of(p: *const u8, n: usize) -> Vec<u8> {
    if p.is_null() || n == 0 {
        vec![]
    } else {
        std::slice::from_raw_parts(p, n).to_vec()
    }
}

/// Opens the profile (`dir`: the browser's data folder) and starts the background work.
#[no_mangle]
pub unsafe extern "C" fn unk_init(dir: *const c_char) -> *mut c_char {
    let dir = PathBuf::from(text(dir));
    let r = catch_unwind(|| {
        let first = std::sync::atomic::AtomicBool::new(false);
        static STARTED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
        STARTED.get_or_init(|| {
            first.store(true, std::sync::atomic::Ordering::Relaxed);
            // (the core's download ids: unique across runs, apart from Gecko's)
            NEXT_DOWNLOAD.store((store::now_ms() / 1000) as u32, std::sync::atomic::Ordering::Relaxed);
            let st = state::init(dir.clone());
            st.blocker.start();
            tracking::start(st.profile.join("adblock"));
            shields::privacy_changed(&st.store.settings()["privacy"]);
            scan::resume();
            apps::init();
            // what changed is saved every few seconds
            std::thread::spawn(|| loop {
                std::thread::sleep(Duration::from_secs(4));
                state::app().store.save_all();
            });
        });
        let st = state::app();
        json!({ "profile": st.profile.to_string_lossy(), "data": st.store.data.to_string_lossy(), "tyranWalls": store::tyran_wallpapers(&st.store.data).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(), "settings": st.store.settings(), "engines": st.store.engines, "bookmarks": st.store.bookmarks.lock().unwrap().value.clone() })
    });
    out(r.unwrap_or_else(|_| json!({ "error": "init failed" })).to_string())
}

/// A command answered at once: {"ok": …} or {"err": "…"}.
#[no_mangle]
pub unsafe extern "C" fn unk_call(cmd: *const c_char, args: *const c_char, bytes: *const u8, len: usize) -> *mut c_char {
    let (c, a, b) = (text(cmd), text(args), bytes_of(bytes, len));
    out(run(&c, &a, b).to_string())
}

/// A command run on a thread of its own: its answer comes as {"event":"__result","payload":{"id",…}}.
#[no_mangle]
pub unsafe extern "C" fn unk_submit(id: u32, cmd: *const c_char, args: *const c_char, bytes: *const u8, len: usize) {
    let (c, a, b) = (text(cmd), text(args), bytes_of(bytes, len));
    std::thread::spawn(move || {
        let mut v = run(&c, &a, b);
        v["id"] = json!(id);
        tauri::push("__result", v);
    });
}

/// The next event, waiting up to `wait_ms` (null when there was none).
#[no_mangle]
pub extern "C" fn unk_next(wait_ms: u32) -> *mut c_char {
    match tauri::next(Duration::from_millis(wait_ms as u64)) {
        Some(s) => out(s),
        None => std::ptr::null_mut(),
    }
}

/// Wakes the waiting worker (the browser closes).
#[no_mangle]
pub extern "C" fn unk_wake() {
    tauri::push("__wake", Value::Null);
}

/// 1: the request is blocked (the ad blocker's lists, for `kind` "script", "image", "xhr"…).
#[no_mangle]
pub unsafe extern "C" fn unk_block(url: *const c_char, source: *const c_char, kind: *const c_char) -> i32 {
    let (u, s, k) = (text(url), text(source), text(kind));
    catch_unwind(|| {
        let st = state::app();
        if !st.flags.adblock() || st.flags.adblock_off_for(&urls::host_of(&s)) {
            return 0;
        }
        st.blocker.should_block(&u, &s, &k) as i32
    })
    .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn unk_free(p: *mut c_char) {
    if !p.is_null() {
        drop(CString::from_raw(p));
    }
}

#[no_mangle]
pub extern "C" fn unk_save() {
    let _ = catch_unwind(|| state::app().store.save_all());
}

#[allow(dead_code)]
fn _uses(_: Manager2) {}
type Manager2 = ();
#[allow(dead_code)]
fn _m(a: &AppHandle) -> &state::App {
    a.state::<state::App>()
}
