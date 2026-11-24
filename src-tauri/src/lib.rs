//! Unknow Web Browser: a light browser on the WebView2 that comes with Windows.
//!
//! One native window per browser window. In it, the "shell" webview draws the interface (tabs,
//! address bar, menus, wallpaper) and each tab is a WebView2 of its own placed over the shell's content
//! area. All of them share one WebView2 environment, so there is one browser process for the whole app.
mod adblock;
mod cleaner;
mod commands;
mod commands2;
mod extras;
mod grab;
mod media;
mod paths;
mod perms;
mod procmem;
mod protocol;
mod shields;
mod state;
mod store;
mod tracking;
mod urls;
mod walls;
mod windows_mgr;
mod wv2;

use state::App;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

pub const APP_ID: &str = "app.unknowweb.browser";
pub const TITLE: &str = "Unknow Web Browser";

/// A file name safe to keep in the profile and to put in a unk:// URL.
pub(crate) fn protocol_name(name: &str) -> String {
    let n: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let n = n.trim_matches('.').to_string();
    if n.is_empty() { "file".into() } else { n }
}

pub fn run() {
    // Windows groups the app's processes (WebView2's included) under this ID in the taskbar.
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&windows::core::HSTRING::from(APP_ID));
    }

    let app_state = App::new();
    app_state.blocker.start();
    tracking::start(app_state.profile.join("adblock"));

    tauri::Builder::default()
        .manage(app_state)
        .register_asynchronous_uri_scheme_protocol("unk", protocol::handle)
        .invoke_handler(commands::handler())
        .setup(|app| {
            let handle = app.handle().clone();
            shields::privacy_changed(&handle.state::<App>().store.settings()["privacy"]);
            windows_mgr::open_startup_windows(&handle);
            // save what changed every few seconds
            let h2 = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(4));
                h2.state::<App>().store.save_all();
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Destroyed => windows_mgr::window_gone(window.app_handle(), window.label()),
            // Alt+Tab back to a window: Windows gives the keyboard to the frame, not to the page or the
            // shell inside it. Hand it on (only when nothing inside has it: a click already placed it).
            WindowEvent::Focused(true) if window.label().starts_with("win-") => {
                let (w, label) = (window.clone(), window.label().to_string());
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    let w2 = w.clone();
                    let _ = w.run_on_main_thread(move || {
                        let Ok(hwnd) = w2.hwnd() else { return };
                        let focus = unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetFocus() };
                        if focus.0.is_null() || focus.0 == hwnd.0 {
                            let _ = w2.app_handle().emit("win-refocus", serde_json::json!({ "win": label }));
                        }
                    });
                });
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("Unknow Web Browser could not start")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, code, .. } => {
                // the last browser window closed: quit (popups alone do not keep the app open)
                if code.is_none() && windows_mgr::browser_windows(app) > 0 {
                    api.prevent_exit();
                }
            }
            RunEvent::Exit => {
                let st = app.state::<App>();
                st.quitting.store(true, Ordering::Relaxed);
                st.store.save_all();
            }
            _ => {}
        });
}
