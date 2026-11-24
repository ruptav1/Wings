//! The second half of what the interface asks: extensions, the media downloader, a page picture as
//! wallpaper, backups, updates, picture in picture, a tab's back / forward list.
use crate::{extras, media, state::App, store::deep_merge};
use base64::Engine as _;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewUrl, WebviewWindowBuilder};

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
fn on_ui(app: &AppHandle, f: impl FnOnce() + Send + 'static) {
    let _ = app.run_on_main_thread(f);
}
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";

#[tauri::command]
pub fn labels_set(app: AppHandle, labels: HashMap<String, String>) {
    *app.state::<App>().labels.write().unwrap() = labels;
}

// ---------- picture in picture, a tab's history ----------
#[tauri::command]
pub fn tab_pip(app: AppHandle, id: String) {
    on_ui(&app, move || {
        extras::cdp(&id, "Runtime.evaluate", json!({ "expression": extras::PIP_JS, "userGesture": true, "awaitPromise": true }), |_| {})
    });
}

#[tauri::command]
pub async fn tab_history(app: AppHandle, id: String) -> R<Value> {
    let (tx, rx) = mpsc::channel();
    on_ui(&app, move || extras::cdp(&id, "Page.getNavigationHistory", json!({}), move |v| drop(tx.send(v))));
    rx.recv_timeout(Duration::from_secs(3)).map_err(err)?.ok_or_else(|| "no history".into())
}

/// Runs a script in a tab's page and gives back its result (the "Đang phát" panel reads and drives the
/// page's player with it).
#[tauri::command]
pub async fn tab_eval(app: AppHandle, id: String, js: String) -> R<Value> {
    let (tx, rx) = mpsc::channel();
    on_ui(&app, move || crate::wv2::eval(&id, &js, move |r| drop(tx.send(r))));
    let s = rx.recv_timeout(Duration::from_secs(3)).map_err(err)?;
    Ok(serde_json::from_str(&s).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn tab_history_go(app: AppHandle, id: String, entry: i64) {
    on_ui(&app, move || extras::cdp(&id, "Page.navigateToHistoryEntry", json!({ "entryId": entry }), |_| {}));
}

// ---------- media ----------
#[tauri::command]
pub async fn media_download(app: AppHandle, tab: String, url: String, kind: String, title: String) -> R<u32> {
    let page = app.state::<App>().tabs.lock().unwrap().get(&tab).map(|t| t.url.clone()).unwrap_or_default();
    let (tx, rx) = mpsc::channel();
    let (t2, u2) = (tab.clone(), url.clone());
    on_ui(&app, move || extras::cookies_for(&t2, &u2, move |c| drop(tx.send(c))));
    let cookies = rx.recv_timeout(Duration::from_secs(3)).unwrap_or_default();
    Ok(media::start(app, url, kind, title, page, cookies))
}

#[tauri::command]
pub fn media_cancel(id: u32) {
    media::cancel(id);
}

// ---------- extensions ----------
fn ext_dir(app: &AppHandle) -> PathBuf {
    app.state::<App>().profile.join("extensions")
}

fn ext_index(app: &AppHandle) -> Value {
    fs::read_to_string(ext_dir(app).join("index.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!({}))
}

fn ext_index_save(app: &AppHandle, v: &Value) {
    let _ = fs::create_dir_all(ext_dir(app));
    let _ = fs::write(ext_dir(app).join("index.json"), serde_json::to_vec_pretty(v).unwrap_or_default());
}

/// The zip inside a .crx (version 2 or 3).
fn crx_zip(b: &[u8]) -> R<&[u8]> {
    if b.len() < 16 || &b[0..4] != b"Cr24" {
        // (some sources hand out the zip itself)
        return if b.starts_with(b"PK") { Ok(b) } else { Err("Không phải tệp tiện ích (.crx)".into()) };
    }
    let u32le = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize;
    let start = match u32le(4) {
        3 => 12 + u32le(8),
        2 => 16 + u32le(8) + u32le(12),
        v => return Err(format!("Phiên bản .crx {v} chưa hỗ trợ")),
    };
    b.get(start..).ok_or_else(|| "Tệp .crx hỏng".into())
}

fn unzip_to(zip_bytes: &[u8], dir: &Path) -> R<()> {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).map_err(err)?;
    let mut z = zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(err)?;
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(err)?;
        let Some(rel) = f.enclosed_name() else { continue };
        if rel.starts_with("_metadata") {
            continue; // (the store's signature: WebView2 refuses folders starting with "_" but _locales)
        }
        let out = dir.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(err)?;
        } else {
            if let Some(p) = out.parent() {
                fs::create_dir_all(p).map_err(err)?;
            }
            let mut buf = vec![];
            f.read_to_end(&mut buf).map_err(err)?;
            fs::write(&out, buf).map_err(err)?;
        }
    }
    Ok(())
}

/// A Chrome Web Store link or ID, or a folder holding an unpacked extension.
fn store_id(source: &str) -> Option<String> {
    let is_id = |s: &str| s.len() == 32 && s.chars().all(|c| ('a'..='p').contains(&c));
    if is_id(source.trim()) {
        return Some(source.trim().to_string());
    }
    source.split(['/', '?', '#']).find(|p| is_id(p)).map(|s| s.to_string())
}

async fn add_folder(app: &AppHandle, folder: PathBuf) -> R<(String, String)> {
    let (tx, rx) = mpsc::channel();
    let path = folder.to_string_lossy().to_string();
    on_ui(app, move || extras::ext_add(&path, move |r| drop(tx.send(r))));
    rx.recv_timeout(Duration::from_secs(20)).map_err(err)?
}

#[tauri::command]
pub async fn ext_install(app: AppHandle, source: String) -> R<Value> {
    let src = source.trim().to_string();
    let (folder, sid) = if Path::new(&src).join("manifest.json").exists() {
        (PathBuf::from(&src), None)
    } else {
        let id = store_id(&src).ok_or("Dán link trang tiện ích trên Chrome Web Store, hoặc đường dẫn thư mục tiện ích đã giải nén")?;
        let url = format!("https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0&acceptformat=crx2,crx3&x=id%3D{id}%26uc");
        let resp = ureq::get(&url).set("User-Agent", UA).timeout(Duration::from_secs(60)).call().map_err(|e| format!("Không tải được tiện ích: {e}"))?;
        let mut bytes = vec![];
        resp.into_reader().take(200 * 1024 * 1024).read_to_end(&mut bytes).map_err(err)?;
        let dir = ext_dir(&app).join(&id);
        unzip_to(crx_zip(&bytes)?, &dir)?;
        (dir, Some(id))
    };
    let (id, name) = add_folder(&app, folder.clone()).await?;
    let mut idx = ext_index(&app);
    idx[&id] = json!({ "path": folder.to_string_lossy(), "store": sid });
    ext_index_save(&app, &idx);
    let _ = app.emit("extensions", json!({}));
    Ok(json!({ "id": id, "name": name }))
}

/// Reads what the toolbar needs from an extension's manifest: its popup, options page and icon.
fn manifest_info(folder: &Path, lang: &str) -> Value {
    let Some(m) = fs::read_to_string(folder.join("manifest.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { return json!({}) };
    let action = if m["action"].is_object() { &m["action"] } else { &m["browser_action"] };
    let popup = action["default_popup"].as_str().or(m["page_action"]["default_popup"].as_str()).unwrap_or("");
    let options = m["options_ui"]["page"].as_str().or(m["options_page"].as_str()).unwrap_or("");
    let icon_rel = ["128", "64", "48", "32", "19", "16"].iter().find_map(|k| m["icons"][k].as_str().or(action["default_icon"][k].as_str())).or(action["default_icon"].as_str());
    let icon = icon_rel
        .and_then(|r| fs::read(folder.join(r.trim_start_matches('/'))).ok())
        .map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
        .unwrap_or_default();
    let msg = |v: &Value| -> Value {
        // "__MSG_extName__": the text from _locales (the interface's language, else English, else the default)
        let Some(key) = v.as_str().and_then(|s| s.strip_prefix("__MSG_")).and_then(|s| s.strip_suffix("__")) else { return v.clone() };
        let default = m["default_locale"].as_str().unwrap_or("en");
        for loc in [lang, "en", default] {
            if let Some(msgs) = fs::read_to_string(folder.join("_locales").join(loc).join("messages.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
                if let Some(obj) = msgs.as_object() {
                    if let Some((_, e)) = obj.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)) {
                        return e["message"].clone();
                    }
                }
            }
        }
        v.clone()
    };
    json!({ "popup": popup, "options": options, "icon": icon, "version": m["version"], "description": msg(&m["description"]), "title": msg(&m["name"]) })
}

#[tauri::command]
pub async fn ext_list(app: AppHandle, lang: Option<String>) -> R<Value> {
    let lang = lang.unwrap_or_else(|| "en".into());
    let (tx, rx) = mpsc::channel();
    on_ui(&app, move || extras::ext_list(move |l| drop(tx.send(l.map(|v| v.into_iter().map(|e| (e.id, e.name, e.enabled)).collect::<Vec<_>>())))));
    let list = rx.recv_timeout(Duration::from_secs(5)).map_err(err)?.ok_or("Cần mở ít nhất một tab thường")?;
    let idx = ext_index(&app);
    Ok(json!(list
        .into_iter()
        // only what was installed here: WebView2's own parts (its PDF viewer, its clipboard helper) are
        // listed as extensions too, and must not be removed
        .filter(|(id, _, _)| idx.get(id).is_some())
        .map(|(id, name, enabled)| {
            let info = idx[&id]["path"].as_str().map(|p| manifest_info(Path::new(p), &lang)).unwrap_or(json!({}));
            let name = match info["title"].as_str() {
                Some(t) if name.starts_with("__MSG_") || name.is_empty() => t.to_string(),
                _ => name,
            };
            let mut v = json!({ "id": id, "name": name, "enabled": enabled, "store": idx[&id]["store"] });
            deep_merge(&mut v, &info);
            v
        })
        .collect::<Vec<_>>()))
}

#[tauri::command]
pub fn ext_toggle(app: AppHandle, id: String, enabled: bool) {
    let a = app.clone();
    on_ui(&app, move || extras::ext_enable(id, enabled, a));
}

#[tauri::command]
pub fn ext_remove(app: AppHandle, id: String) {
    let mut idx = ext_index(&app);
    if let Some(p) = idx[&id]["path"].as_str().map(PathBuf::from) {
        if p.starts_with(ext_dir(&app)) {
            let _ = fs::remove_dir_all(p);
        }
    }
    if let Some(m) = idx.as_object_mut() {
        m.remove(&id);
    }
    ext_index_save(&app, &idx);
    let a = app.clone();
    on_ui(&app, move || extras::ext_remove(id, a));
}

/// An extension's popup or options page, in a small window of its own.
#[tauri::command]
pub async fn ext_open(app: AppHandle, id: String, page: String, popup: bool) -> R<()> {
    let st = app.state::<App>();
    let url: tauri::Url = format!("chrome-extension://{id}/{}", page.trim_start_matches('/')).parse().map_err(err)?;
    let label = format!("ext-{}-{}", if popup { "popup" } else { "options" }, &id[..8.min(id.len())]);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
    }
    let (w, h) = if popup { (400.0, 560.0) } else { (980.0, 720.0) };
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title(crate::TITLE)
        .inner_size(w, h)
        .data_directory(st.webview_data_dir())
        .additional_browser_args(&st.browser_args())
        .browser_extensions_enabled(true)
        .always_on_top(popup)
        .build()
        .map_err(err)?;
    Ok(())
}

// ---------- backups ----------
#[tauri::command]
pub fn backup_export(app: AppHandle) -> Value {
    let st = app.state::<App>();
    let s = &st.store;
    json!({
        "app": crate::TITLE,
        "version": 1,
        "created": crate::store::now_ms(),
        "settings": s.settings.lock().unwrap().value,
        "bookmarks": s.bookmarks.lock().unwrap().value,
        "notes": s.notes.lock().unwrap().value,
        "history": s.history.lock().unwrap().visits,
    })
}

#[tauri::command]
pub fn backup_import(app: AppHandle, data: Value) -> R<()> {
    if data["version"].as_u64() != Some(1) || !data["settings"].is_object() {
        return Err("Tệp sao lưu không hợp lệ".into());
    }
    let st = app.state::<App>();
    {
        let mut d = st.store.settings.lock().unwrap();
        deep_merge(&mut d.value, &data["settings"]);
        d.touch();
    }
    if data["bookmarks"].is_object() {
        let mut d = st.store.bookmarks.lock().unwrap();
        d.value = data["bookmarks"].clone();
        d.touch();
    }
    if data["notes"].is_object() {
        let mut d = st.store.notes.lock().unwrap();
        d.value = data["notes"].clone();
        d.touch();
    }
    if let Ok(visits) = serde_json::from_value::<Vec<crate::store::Visit>>(data["history"].clone()) {
        let mut h = st.store.history.lock().unwrap();
        let mut all = h.visits.clone();
        all.extend(visits);
        all.sort_by_key(|v| v.ts);
        all.dedup_by(|a, b| a.url == b.url && a.ts == b.ts);
        h.visits = all;
        h.touch();
    }
    st.store.save_all();
    let _ = app.emit("settings", st.store.settings());
    let _ = app.emit("bookmarks", st.store.bookmarks.lock().unwrap().value.clone());
    Ok(())
}

// ---------- updates ----------
fn newer(a: &str, b: &str) -> bool {
    let p = |s: &str| s.trim_start_matches('v').split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    p(a) > p(b)
}

/// Looks for a newer release on GitHub (Settings → Chung → Kho phát hành: "owner/repo").
#[tauri::command]
pub async fn update_check(app: AppHandle) -> R<Value> {
    let repo = app.state::<App>().store.setting_str(&["general", "updateRepo"]);
    let current = app.package_info().version.to_string();
    if repo.trim().is_empty() {
        return Ok(json!({ "current": current, "latest": null, "repo": "" }));
    }
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo.trim());
    let v: Value = ureq::get(&url).set("User-Agent", "UnknowWebBrowser-update-check").timeout(Duration::from_secs(10)).call().map_err(err)?.into_string().map_err(err).and_then(|s| serde_json::from_str(&s).map_err(err))?;
    let latest = v["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    Ok(json!({ "current": current, "latest": latest, "newer": newer(&latest, &current), "url": v["html_url"], "repo": repo }))
}

#[allow(dead_code)]
fn _webview(_: Webview) {}
