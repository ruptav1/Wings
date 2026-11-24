//! Browser windows: each one a native window holding its shell webview (the interface) and its tabs.
use crate::{
    state::{App, WinMeta},
    TITLE,
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewBuilder, WebviewUrl};

pub fn browser_windows(app: &AppHandle) -> usize {
    app.state::<App>().windows.lock().unwrap().len()
}

/// The windows of the last session (Settings → Khi khởi động → Mở lại các tab), or one new window.
pub fn open_startup_windows(app: &AppHandle) {
    let st = app.state::<App>();
    let cli_url = std::env::args().skip(1).find(|a| a.starts_with("http://") || a.starts_with("https://") || a.ends_with(".html"));
    let restore = st.store.setting_str(&["general", "startup"]) == "restore";
    let saved: Vec<Value> = {
        let mut doc = st.store.sessions.lock().unwrap();
        let list = match &doc.value["windows"] {
            Value::Object(m) => m.values().cloned().collect(),
            Value::Array(a) => a.clone(),
            _ => vec![],
        };
        doc.value["windows"] = json!({});
        doc.touch();
        list
    };
    let saved: Vec<Value> = if restore { saved.into_iter().filter(|s| s["tabs"].as_array().is_some_and(|t| !t.is_empty())).collect() } else { vec![] };
    if saved.is_empty() {
        let _ = open_window(app, WinMeta { private: false, restore: None, open_url: cli_url, adopt: None });
        return;
    }
    for (i, s) in saved.into_iter().enumerate() {
        let url = if i == 0 { cli_url.clone() } else { None };
        let _ = open_window(app, WinMeta { private: false, restore: Some(s), open_url: url, adopt: None });
    }
}

pub fn open_window(app: &AppHandle, meta: WinMeta) -> tauri::Result<String> {
    let st = app.state::<App>();
    let n = st.next_win.fetch_add(1, Ordering::Relaxed);
    let label = format!("win-{n}");
    let bounds = meta.restore.as_ref().map(|r| r["bounds"].clone()).unwrap_or(Value::Null);
    let private = meta.private;
    st.windows.lock().unwrap().insert(label.clone(), meta);

    let mut b = tauri::window::WindowBuilder::new(app, &label)
        .title(if private { format!("{TITLE} (InPrivate)") } else { TITLE.to_string() })
        .inner_size(1280.0, 820.0)
        .min_inner_size(480.0, 360.0)
        .decorations(false)
        .shadow(true)
        .visible(false);
    if let (Some(w), Some(h)) = (bounds["w"].as_f64(), bounds["h"].as_f64()) {
        b = b.inner_size(w.max(480.0), h.max(360.0));
        if let (Some(x), Some(y)) = (bounds["x"].as_f64(), bounds["y"].as_f64()) {
            b = b.position(x, y);
        }
        if bounds["maximized"].as_bool() == Some(true) {
            b = b.maximized(true);
        }
    } else if let Some(m) = app.primary_monitor().ok().flatten() {
        // a first window: most of the screen, never larger than it
        let scale = m.scale_factor();
        let work = m.work_area();
        let (sw, sh) = (work.size.width as f64 / scale, work.size.height as f64 / scale);
        let (w, h) = ((sw * 0.86).min(1440.0).max(480.0), (sh * 0.88).min(940.0).max(360.0));
        b = b.inner_size(w, h).position(work.position.x as f64 / scale + (sw - w) / 2.0, work.position.y as f64 / scale + (sh - h) / 2.0);
        if sw < 1100.0 || sh < 700.0 {
            b = b.maximized(true);
        }
    } else {
        b = b.center();
    }
    let win = b.build()?;
    let size = win.inner_size()?.to_logical::<f64>(win.scale_factor()?);

    let shell = WebviewBuilder::new(format!("shell-{n}"), WebviewUrl::App("index.html".into()))
        .data_directory(st.webview_data_dir())
        .additional_browser_args(&st.browser_args())
        .browser_extensions_enabled(true)
        .on_navigation(|u| u.host_str() == Some("tauri.localhost"))
        .auto_resize();
    win.add_child(shell, LogicalPosition::new(0.0, 0.0), LogicalSize::new(size.width, size.height))?;
    Ok(label)
}

pub fn window_gone(app: &AppHandle, label: &str) {
    let st = app.state::<App>();
    let removed = st.windows.lock().unwrap().remove(label);
    if removed.is_none() {
        return; // (a popup or the task manager)
    }
    st.tabs.lock().unwrap().retain(|_, t| t.win != label);
    let others = st.windows.lock().unwrap().len();
    // a window closed while others stay open is not reopened next time; the last one is
    if others > 0 && !st.quitting.load(Ordering::Relaxed) {
        let mut doc = st.store.sessions.lock().unwrap();
        if let Some(m) = doc.value["windows"].as_object_mut() {
            m.remove(label);
        }
        doc.touch();
    }
    if others == 0 {
        st.store.save_all();
        app.exit(0);
    }
}

/// Position and size to reopen the window with.
pub fn window_bounds(win: &tauri::Window) -> Value {
    let scale = win.scale_factor().unwrap_or(1.0);
    let maximized = win.is_maximized().unwrap_or(false);
    let pos: PhysicalPosition<i32> = win.outer_position().unwrap_or_default();
    let size: PhysicalSize<u32> = win.inner_size().unwrap_or_default();
    if maximized {
        // keep the size it had before (what it un-maximizes to): not known here, so keep the last one
        return json!({ "maximized": true });
    }
    json!({ "x": pos.x as f64 / scale, "y": pos.y as f64 / scale, "w": size.width as f64 / scale, "h": size.height as f64 / scale, "maximized": false })
}
