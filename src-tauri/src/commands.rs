//! What the interface (shell and unk:// pages) asks of the browser.
use crate::{
    procmem,
    state::{App, TabMeta, WinMeta},
    store::deep_merge,
    urls, windows_mgr, wv2,
};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::mpsc, time::Duration};
use tauri::{
    webview::{NewWindowFeatures, NewWindowResponse},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewBuilder, WebviewUrl, WebviewWindowBuilder,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MBUTTON, VK_SHIFT};

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Bounds {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
impl Bounds {
    fn rect(&self) -> Rect {
        Rect { position: LogicalPosition::new(self.x, self.y).into(), size: LogicalSize::new(self.w.max(1.0), self.h.max(1.0)).into() }
    }
}

fn tab_label(id: &str) -> String {
    format!("tab-{id}")
}
fn tab_wv(app: &AppHandle, id: &str) -> Option<Webview> {
    app.get_webview(&tab_label(id))
}
/// Runs `f` on the UI thread, where the WebView2 objects live.
fn on_ui(app: &AppHandle, f: impl FnOnce() + Send + 'static) {
    let _ = app.run_on_main_thread(f);
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![
        win_init, win_new, win_action, win_show, shell_focus, shell_devtools, keys_set, session_save,
        tab_create, tab_close, tab_load, tab_nav, tab_bounds, tab_show, tab_hide, tab_zoom, tab_mute, tab_freeze, tab_thaw,
        tab_find, tab_find_stop, tab_capture, tab_screenshot, tab_pdf, tab_exec, tab_focus, tab_move,
        settings_get, settings_set, settings_reset, engines_get,
        bookmarks_get, bookmarks_set, history_query, history_suggest, history_delete, history_delete_range,
        downloads_list, download_action, downloads_clear, file_open, file_show,
        notes_get, notes_set, suggest_fetch, open_tab, taskmgr_open, taskmgr_snapshot, process_kill,
        clear_data, adblock_status, adblock_update, app_info, frame_of,
        crate::walls::wallpaper_save, crate::walls::wallpaper_list, crate::walls::wallpaper_delete, crate::walls::wallpaper_meta, crate::walls::wallpaper_thumb,
        crate::walls::wallpaper_from_url, crate::walls::wallpaper_video_url, crate::walls::wall_search, crate::walls::wall_get,
        crate::walls::store_page, crate::walls::store_download, crate::walls::store_cancel,
        crate::perms::perm_respond, crate::perms::perm_set, crate::cleaner::cleaner_scan, crate::cleaner::cleaner_run, crate::walls::wallpaper_desktop,
        crate::grab::grab_tools, crate::grab::grab_info, crate::grab::grab_download,
        crate::commands2::labels_set, crate::commands2::tab_pip, crate::commands2::tab_history, crate::commands2::tab_history_go, crate::commands2::tab_eval,
        crate::commands2::media_download, crate::commands2::media_cancel,
        crate::commands2::ext_install, crate::commands2::ext_list, crate::commands2::ext_toggle, crate::commands2::ext_remove, crate::commands2::ext_open,
        crate::commands2::backup_export, crate::commands2::backup_import, crate::commands2::update_check
    ]
}

// ---------- windows ----------
#[tauri::command]
fn win_init(app: AppHandle, webview: Webview) -> R<Value> {
    let st = app.state::<App>();
    let win = webview.window();
    let label = win.label().to_string();
    let (private, restore, url, adopt) = {
        let mut w = st.windows.lock().unwrap();
        match w.get_mut(&label) {
            Some(m) => (m.private, m.restore.take(), m.open_url.take(), m.adopt.take()),
            None => (false, None, None, None),
        }
    };
    let closed = st.store.sessions.lock().unwrap().value["closed"].clone();
    Ok(json!({
        "win": label,
        "private": private,
        "settings": st.store.settings(),
        "engines": st.store.engines,
        "bookmarks": st.store.bookmarks.lock().unwrap().value.clone(),
        "restore": restore,
        "url": url,
        "adopt": adopt,
        "closed": if private { json!([]) } else { closed },
        "maximized": win.is_maximized().unwrap_or(false),
    }))
}

/// Gives the keyboard to the shell (from a page: the address bar, the find bar, a menu).
#[tauri::command]
fn shell_focus(webview: Webview) {
    let _ = webview.set_focus();
}

/// The shell's own developer tools (Ctrl+Shift+F12), for working on the interface.
#[tauri::command]
fn shell_devtools(webview: Webview) {
    webview.open_devtools();
}

#[tauri::command]
fn win_show(webview: Webview) {
    let _ = webview.window().show();
    let _ = webview.window().set_focus();
}

#[tauri::command]
fn win_new(app: AppHandle, private: bool, url: Option<String>, adopt: Option<Value>) -> R<()> {
    // (window creation must not run in a synchronous command's thread on Windows)
    let a = app.clone();
    std::thread::spawn(move || {
        let _ = windows_mgr::open_window(&a, WinMeta { private, restore: None, open_url: url, adopt });
    });
    Ok(())
}

#[tauri::command]
fn win_action(webview: Webview, action: String) -> R<Value> {
    let w = webview.window();
    match action.as_str() {
        "minimize" => w.minimize().map_err(err)?,
        "maximize" => {
            if w.is_maximized().unwrap_or(false) {
                w.unmaximize().map_err(err)?
            } else {
                w.maximize().map_err(err)?
            }
        }
        "close" => w.close().map_err(err)?,
        "fullscreen" => w.set_fullscreen(true).map_err(err)?,
        "leaveFullscreen" => w.set_fullscreen(false).map_err(err)?,
        "toggleFullscreen" => w.set_fullscreen(!w.is_fullscreen().unwrap_or(false)).map_err(err)?,
        "drag" => w.start_dragging().map_err(err)?,
        _ => {}
    }
    Ok(json!({ "maximized": w.is_maximized().unwrap_or(false), "fullscreen": w.is_fullscreen().unwrap_or(false) }))
}

#[tauri::command]
fn keys_set(app: AppHandle, keys: Vec<String>) {
    *app.state::<App>().keys.write().unwrap() = keys.into_iter().collect();
}

#[tauri::command]
fn session_save(app: AppHandle, webview: Webview, mut session: Value, closed: Option<Value>) {
    let st = app.state::<App>();
    let win = webview.window();
    let label = win.label().to_string();
    if st.windows.lock().unwrap().get(&label).map(|m| m.private).unwrap_or(true) {
        return;
    }
    let bounds = windows_mgr::window_bounds(&win);
    let mut doc = st.store.sessions.lock().unwrap();
    // maximized: keep the size it had before
    let prev = doc.value["windows"][&label]["bounds"].clone();
    session["bounds"] = if bounds["maximized"].as_bool() == Some(true) {
        let mut b = if prev.is_object() { prev } else { json!({}) };
        b["maximized"] = json!(true);
        b
    } else {
        bounds
    };
    if !doc.value["windows"].is_object() {
        doc.value["windows"] = json!({});
    }
    doc.value["windows"][&label] = session;
    if let Some(c) = closed {
        doc.value["closed"] = c;
    }
    doc.touch();
}

// ---------- tabs ----------
fn new_window_handler(app: AppHandle, id: String) -> impl Fn(tauri::Url, NewWindowFeatures) -> NewWindowResponse<tauri::Wry> + Send + 'static {
    move |url, features| {
        let u = url.to_string();
        let st = app.state::<App>();
        let opener = st.tabs.lock().unwrap().get(&id).map(|t| (t.url.clone(), t.win.clone(), t.private));
        let Some((opener_url, win, private)) = opener else { return NewWindowResponse::Deny };
        if urls::is_internal_real(&u) && !opener_url.starts_with("unk://") {
            return NewWindowResponse::Deny;
        }
        // a sized popup (sign-in windows and the like) stays a popup, linked to its page
        if features.size().is_some() && !urls::is_internal_real(&u) {
            static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
            let label = format!("popup-{}", N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
            let env = features.opener().environment.clone();
            let built = WebviewWindowBuilder::new(&app, label, WebviewUrl::External("about:blank".parse().unwrap()))
                .window_features(features)
                .with_environment(env)
                .incognito(private)
                .title(crate::TITLE)
                .on_document_title_changed(|w, t| {
                    let _ = w.set_title(&t);
                })
                .build();
            return match built {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            };
        }
        // Ctrl / middle click: behind the current tab
        let held = |k: i32| unsafe { GetAsyncKeyState(k) } as u16 & 0x8000 != 0;
        let background = held(VK_CONTROL.0 as i32) || held(VK_MBUTTON.0 as i32);
        let _ = held(VK_SHIFT.0 as i32);
        let _ = app.emit("tab-open", json!({ "win": win, "opener": id, "url": urls::to_display(&u), "background": background }));
        NewWindowResponse::Deny
    }
}

#[tauri::command]
async fn tab_create(app: AppHandle, webview: Webview, id: String, url: String, private: bool, bounds: Bounds, show: bool, zoom: Option<f64>) -> R<()> {
    if tab_wv(&app, &id).is_some() {
        return Ok(());
    }
    let st = app.state::<App>();
    let win = webview.window();
    let real = urls::to_real(if url.is_empty() { "unk://newtab" } else { &url });
    // (it starts blank and goes to its page once its events are wired: the first page gets Shields too)
    let blank: tauri::Url = "about:blank".parse().map_err(err)?;
    let builder = WebviewBuilder::new(tab_label(&id), WebviewUrl::External(blank))
        .data_directory(st.webview_data_dir())
        .additional_browser_args(&st.browser_args())
        .incognito(private)
        .browser_extensions_enabled(true)
        .devtools(true)
        .on_new_window(new_window_handler(app.clone(), id.clone()));
    st.tabs.lock().unwrap().insert(id.clone(), TabMeta { win: win.label().to_string(), url: urls::to_display(&real), private });
    let wv = win
        .add_child(builder, LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.w.max(1.0), bounds.h.max(1.0)))
        .map_err(err)?;
    if !show {
        let _ = wv.hide();
    }
    let (a, i) = (app.clone(), id.clone());
    let z = zoom.unwrap_or(1.0);
    let first = urls::to_display(&real);
    wv.with_webview(move |pw| {
        let _ = wv2::hook(a.clone(), i.clone(), private, pw.controller(), pw.environment());
        if (z - 1.0).abs() > 0.001 {
            wv2::set_zoom(&i, z);
        }
        wv2::navigate_app(Some(&a), &i, &first);
    })
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
fn tab_close(app: AppHandle, id: String) {
    app.state::<App>().tabs.lock().unwrap().remove(&id);
    let i = id.clone();
    on_ui(&app, move || wv2::forget(&i));
    if let Some(wv) = tab_wv(&app, &id) {
        let _ = wv.close();
    }
}

#[tauri::command]
fn tab_load(app: AppHandle, id: String, url: String) {
    let a = app.clone();
    on_ui(&app, move || wv2::navigate_app(Some(&a), &id, &url));
}

#[tauri::command]
fn tab_nav(app: AppHandle, id: String, action: String) {
    on_ui(&app, move || wv2::nav(&id, &action));
}

#[tauri::command]
fn tab_bounds(app: AppHandle, id: String, bounds: Bounds) {
    if let Some(wv) = tab_wv(&app, &id) {
        let _ = wv.set_bounds(bounds.rect());
    }
}

#[tauri::command]
fn tab_show(app: AppHandle, id: String, bounds: Bounds, focus: Option<bool>) {
    if let Some(wv) = tab_wv(&app, &id) {
        let _ = wv.set_bounds(bounds.rect());
        let _ = wv.show();
        let i = id.clone();
        let f = focus.unwrap_or(false);
        on_ui(&app, move || {
            wv2::thaw(&i);
            if f {
                wv2::nav(&i, "focus");
            }
        });
    }
}

#[tauri::command]
fn tab_hide(app: AppHandle, id: String) {
    if let Some(wv) = tab_wv(&app, &id) {
        let _ = wv.hide();
    }
}

#[tauri::command]
fn tab_focus(app: AppHandle, id: String) {
    on_ui(&app, move || wv2::nav(&id, "focus"));
}

#[tauri::command]
fn tab_zoom(app: AppHandle, id: String, factor: f64) {
    on_ui(&app, move || wv2::set_zoom(&id, factor));
}

#[tauri::command]
fn tab_mute(app: AppHandle, id: String, muted: bool) {
    on_ui(&app, move || wv2::set_muted(&id, muted));
}

#[tauri::command]
fn tab_freeze(app: AppHandle, id: String) {
    on_ui(&app, move || wv2::freeze(&id));
}

#[tauri::command]
fn tab_thaw(app: AppHandle, id: String) {
    on_ui(&app, move || wv2::thaw(&id));
}

#[tauri::command]
fn tab_exec(app: AppHandle, id: String, js: String) {
    on_ui(&app, move || wv2::exec(&id, &js));
}

#[tauri::command]
fn tab_find(app: AppHandle, id: String, text: String, new_search: bool, backwards: bool, case: bool) {
    let a = app.clone();
    on_ui(&app, move || wv2::find(&a, &id, &text, new_search, backwards, case));
}

#[tauri::command]
fn tab_find_stop(app: AppHandle, id: String) {
    on_ui(&app, move || wv2::find_stop(&id));
}

fn capture_bytes(app: &AppHandle, id: String, jpeg: bool) -> Option<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    on_ui(app, move || {
        wv2::capture(&id, jpeg, move |b| {
            let _ = tx.send(b);
        })
    });
    rx.recv_timeout(Duration::from_secs(4)).ok().flatten()
}

/// A picture of the tab as a data: URL (the shell shows it in place of the page while a menu covers it).
#[tauri::command]
async fn tab_capture(app: AppHandle, id: String) -> R<String> {
    let bytes = capture_bytes(&app, id, true).ok_or("capture failed")?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
async fn tab_screenshot(app: AppHandle, id: String) -> R<Value> {
    let bytes = capture_bytes(&app, id, false).ok_or("capture failed")?;
    let dir = app.state::<App>().download_dir().join("Screenshots");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let name = format!("UnknowWeb {}.png", chrono_like_stamp());
    let path = dir.join(name);
    std::fs::write(&path, &bytes).map_err(err)?;
    Ok(json!({ "path": path.to_string_lossy(), "data": format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) }))
}

fn chrono_like_stamp() -> String {
    let ms = crate::store::now_ms();
    format!("{}", ms / 1000)
}

#[tauri::command]
fn tab_pdf(app: AppHandle, id: String, title: String) -> R<String> {
    let dir = app.state::<App>().download_dir();
    let safe: String = title.chars().map(|c| if r#"\/:*?"<>|"#.contains(c) { '_' } else { c }).take(80).collect();
    let path = dir.join(format!("{}.pdf", if safe.trim().is_empty() { "page".to_string() } else { safe }));
    let (a, p) = (app.clone(), path.clone());
    on_ui(&app, move || wv2::print_pdf(&id, &p, a));
    Ok(path.to_string_lossy().to_string())
}

/// Moves a tab to another window (dragging it out of the strip).
#[tauri::command]
fn tab_move(app: AppHandle, id: String, win: String) -> R<()> {
    let wv = tab_wv(&app, &id).ok_or("no tab")?;
    let target = app.get_window(&win).ok_or("no window")?;
    wv.reparent(&target).map_err(err)?;
    if let Some(t) = app.state::<App>().tabs.lock().unwrap().get_mut(&id) {
        t.win = win;
    }
    Ok(())
}

// ---------- settings, bookmarks, history ----------
#[tauri::command]
fn settings_get(app: AppHandle) -> Value {
    app.state::<App>().store.settings()
}

fn settings_changed(app: &AppHandle, s: Value) {
    let st = app.state::<App>();
    let was_cookies = st.flags.cookie_notices();
    st.flags.update(&s);
    // (the cookie-notice list switched: the blocker is built again; third-party cookies follow at the next start)
    if st.flags.cookie_notices() != was_cookies {
        st.blocker.set_cookie_notices(st.flags.cookie_notices());
    }
    // (fingerprinting protection switched, a site's Shields taken down: the tabs' scripts again)
    if crate::shields::privacy_changed(&s["privacy"]) {
        let a = app.clone();
        on_ui(app, move || wv2::refresh_shields(&a));
    }
    let scheme = s["appearance"]["pageScheme"].as_str().unwrap_or("theme").to_string();
    let dark = s["appearance"]["dark"].as_bool().unwrap_or(false);
    on_ui(app, move || wv2::apply_color_scheme(&scheme, dark));
    let _ = app.emit("settings", s);
}

#[tauri::command]
fn settings_set(app: AppHandle, patch: Value) -> Value {
    let s = {
        let st = app.state::<App>();
        let mut doc = st.store.settings.lock().unwrap();
        deep_merge(&mut doc.value, &patch);
        doc.touch();
        doc.value.clone()
    };
    settings_changed(&app, s.clone());
    s
}

#[tauri::command]
fn settings_reset(app: AppHandle, section: Option<String>) -> Value {
    let defaults: Value = serde_json::from_str(include_str!("../defaults/settings.json")).unwrap();
    let s = {
        let st = app.state::<App>();
        let mut doc = st.store.settings.lock().unwrap();
        match section {
            Some(sec) => doc.value[&sec] = defaults[&sec].clone(),
            None => doc.value = defaults,
        }
        doc.touch();
        doc.value.clone()
    };
    settings_changed(&app, s.clone());
    s
}

#[tauri::command]
fn engines_get(app: AppHandle) -> Value {
    app.state::<App>().store.engines.clone()
}

#[tauri::command]
fn bookmarks_get(app: AppHandle) -> Value {
    app.state::<App>().store.bookmarks.lock().unwrap().value.clone()
}

#[tauri::command]
fn bookmarks_set(app: AppHandle, value: Value) {
    {
        let st = app.state::<App>();
        let mut doc = st.store.bookmarks.lock().unwrap();
        doc.value = value.clone();
        doc.touch();
    }
    let _ = app.emit("bookmarks", value);
}

#[tauri::command]
fn history_query(app: AppHandle, text: String, before: Option<u64>, limit: Option<usize>) -> Value {
    let h = app.state::<App>().store.history.lock().unwrap().query(&text, before, limit.unwrap_or(200));
    serde_json::to_value(h).unwrap_or(json!([]))
}

#[tauri::command]
fn history_suggest(app: AppHandle, text: String) -> Value {
    let h = app.state::<App>().store.history.lock().unwrap().suggest(&text, 8);
    serde_json::to_value(h).unwrap_or(json!([]))
}

#[tauri::command]
fn history_delete(app: AppHandle, url: String) {
    app.state::<App>().store.history.lock().unwrap().delete_url(&url);
}

#[tauri::command]
fn history_delete_range(app: AppHandle, from: u64, to: u64) {
    app.state::<App>().store.history.lock().unwrap().delete_range(from, to);
    if from == 0 {
        let st = app.state::<App>();
        let mut doc = st.store.sessions.lock().unwrap();
        doc.value["closed"] = json!([]);
        doc.touch();
    }
    let _ = app.emit("history-cleared", json!({}));
}

// ---------- downloads ----------
#[tauri::command]
fn downloads_list(app: AppHandle) -> Value {
    app.state::<App>().store.downloads.lock().unwrap().value["items"].clone()
}

#[tauri::command]
fn download_action(app: AppHandle, id: u32, action: String) {
    if action == "cancel" {
        crate::media::cancel(id); // (the browser's own downloads: videos)
    }
    on_ui(&app, move || wv2::download_action(id, &action));
}

#[tauri::command]
fn downloads_clear(app: AppHandle, id: Option<u32>) {
    let st = app.state::<App>();
    let mut doc = st.store.downloads.lock().unwrap();
    match id {
        Some(id) => {
            if let Some(a) = doc.value["items"].as_array_mut() {
                a.retain(|d| d["id"].as_u64() != Some(id as u64));
            }
        }
        None => doc.value["items"] = json!([]),
    }
    doc.touch();
}

#[tauri::command]
fn file_open(path: String) -> R<()> {
    std::process::Command::new("explorer").arg(&path).spawn().map_err(err)?;
    Ok(())
}

#[tauri::command]
fn file_show(path: String) -> R<()> {
    std::process::Command::new("explorer").arg(format!("/select,{path}")).spawn().map_err(err)?;
    Ok(())
}

// ---------- the rest ----------
#[tauri::command]
fn notes_get(app: AppHandle) -> Value {
    app.state::<App>().store.notes.lock().unwrap().value.clone()
}

#[tauri::command]
fn notes_set(app: AppHandle, text: String) {
    let st = app.state::<App>();
    let mut doc = st.store.notes.lock().unwrap();
    doc.value["text"] = json!(text);
    doc.touch();
}

/// Search suggestions (the engines' endpoints do not allow pages to fetch them themselves).
#[tauri::command]
async fn suggest_fetch(url: String) -> R<Value> {
    if !url.starts_with("https://") {
        return Err("bad url".into());
    }
    let body = ureq::get(&url).timeout(Duration::from_secs(3)).call().map_err(err)?.into_string().map_err(err)?;
    serde_json::from_str(&body).map_err(err)
}

/// An unk:// page asks for a tab (in its own window).
#[tauri::command]
fn open_tab(app: AppHandle, webview: Webview, url: String, background: Option<bool>) {
    let win = webview.window().label().to_string();
    let win = if win.starts_with("win-") { win } else { app.state::<App>().windows.lock().unwrap().keys().next().cloned().unwrap_or_default() };
    let _ = app.emit("tab-open", json!({ "win": win, "url": url, "background": background.unwrap_or(false) }));
}

#[tauri::command]
async fn taskmgr_open(app: AppHandle) -> R<()> {
    if let Some(w) = app.get_webview_window("taskmgr") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let st = app.state::<App>();
    WebviewWindowBuilder::new(&app, "taskmgr", WebviewUrl::App("pages/taskmgr/index.html".into()))
        .title("Trình quản lý tác vụ - Unknow Web Browser")
        .inner_size(760.0, 520.0)
        .browser_extensions_enabled(true)
        .data_directory(st.webview_data_dir())
        .additional_browser_args(&st.browser_args())
        .build()
        .map_err(err)?;
    Ok(())
}

/// Every process of the browser with its memory and CPU, and which tabs each one shows.
#[tauri::command]
async fn taskmgr_snapshot(app: AppHandle) -> R<Value> {
    let (tx, rx) = mpsc::channel();
    on_ui(&app, move || {
        wv2::processes(move |list| {
            let _ = tx.send(list.into_iter().map(|p| (p.pid, p.kind, p.frames)).collect::<Vec<_>>());
        })
    });
    let list = rx.recv_timeout(Duration::from_secs(4)).map_err(err)?;
    let st = app.state::<App>();
    let tabs: Vec<(String, String)> = st.tabs.lock().unwrap().iter().map(|(id, t)| (id.clone(), t.url.clone())).collect();
    let mut out = Vec::new();
    let me = std::process::id();
    if let Some(u) = procmem::usage(me) {
        out.push(json!({ "pid": me, "kind": "host", "frames": [], "tabs": [], "private": u.private_bytes, "ws": u.working_set, "cpu": u.cpu }));
    }
    for (pid, kind, frames) in list {
        let owners: Vec<&String> = tabs.iter().filter(|(_, url)| frames.iter().any(|f| f == url)).map(|(id, _)| id).collect();
        let u = procmem::usage(pid);
        out.push(json!({
            "pid": pid, "kind": kind, "frames": frames, "tabs": owners,
            "private": u.as_ref().map(|u| u.private_bytes).unwrap_or(0),
            "ws": u.as_ref().map(|u| u.working_set).unwrap_or(0),
            "cpu": u.as_ref().map(|u| u.cpu).unwrap_or(0.0),
        }));
    }
    Ok(json!(out))
}

#[tauri::command]
fn process_kill(pid: u32) -> bool {
    if pid == std::process::id() {
        return false;
    }
    procmem::kill(pid)
}

#[tauri::command]
fn clear_data(app: AppHandle, kinds: String, since: u64) {
    let a = app.clone();
    on_ui(&app, move || wv2::clear_data(&kinds, since, a));
}

#[tauri::command]
fn adblock_status(app: AppHandle) -> Value {
    json!({ "ready": app.state::<App>().blocker.ready() })
}

#[tauri::command]
async fn adblock_update(app: AppHandle) -> Value {
    let b = app.state::<App>().blocker;
    b.rebuild(true);
    json!({ "ready": b.ready() })
}

/// Where a page sits in its window, in CSS pixels (the new tab page lines its wallpaper up with the
/// window's when it is shown as a page, in split view).
#[tauri::command]
fn frame_of(webview: Webview) -> Value {
    let win = webview.window();
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos = webview.position().map(|p| p.to_logical::<f64>(scale)).unwrap_or(tauri::LogicalPosition::new(0.0, 0.0));
    let size = win.inner_size().map(|s| s.to_logical::<f64>(scale)).unwrap_or(tauri::LogicalSize::new(0.0, 0.0));
    json!({ "x": pos.x, "y": pos.y, "w": size.width, "h": size.height })
}

#[tauri::command]
fn app_info(app: AppHandle) -> Value {
    let st = app.state::<App>();
    let wv2 = webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    let mut ver = windows::core::PWSTR::null();
    let version = unsafe { wv2(None, &mut ver).ok().map(|_| webview2_com::take_pwstr(ver)).unwrap_or_default() };
    json!({
        "name": crate::TITLE,
        "version": app.package_info().version.to_string(),
        "webview2": version,
        "profile": st.profile.to_string_lossy(),
        "downloads": st.download_dir().to_string_lossy(),
    })
}

#[allow(dead_code)]
fn _unused(_: PathBuf) {}
