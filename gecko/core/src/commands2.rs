//! Backups, updates, and the media downloader's start (the page's cookies come from the Gecko side).
use crate::{media, state::App, store::deep_merge};
use serde_json::{json, Value};
use std::time::Duration;
use crate::tauri::{AppHandle, Emitter, Manager};

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------- media ----------
pub fn media_start(app: AppHandle, url: String, kind: String, title: String, referer: String, cookies: String) -> u32 {
    media::start(app, url, kind, title, referer, cookies)
}

pub fn media_cancel(id: u32) {
    media::cancel(id);
}

// ---------- backups ----------
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
        for v in all.iter_mut().filter(|v| v.id.is_empty()) {
            v.id = crate::store::uid("h");
        }
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
pub async fn update_check(app: AppHandle) -> R<Value> {
    let repo = app.state::<App>().store.setting_str(&["general", "updateRepo"]);
    let current = app.package_info().version.to_string();
    if repo.trim().is_empty() {
        return Ok(json!({ "current": current, "latest": null, "repo": "" }));
    }
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo.trim());
    let v: Value = ureq::get(&url).set("User-Agent", "Wings-update-check").timeout(Duration::from_secs(10)).call().map_err(err)?.into_string().map_err(err).and_then(|s| serde_json::from_str(&s).map_err(err))?;
    let latest = v["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    Ok(json!({ "current": current, "latest": latest, "newer": newer(&latest, &current), "url": v["html_url"], "repo": repo }))
}

