//! What sites may use (camera, microphone, location, notifications…): asked in the browser's own
//! prompt under the address bar (the shell: commands.js), the answer kept per site when the user says
//! so (settings.sitePermissions: { "https://site": { "camera": "allow" | "deny" } }), never for a
//! private window. Settings → Quyền riêng tư and the site's info popover list and change them.
use crate::{state::App, store::deep_merge, wv2::s};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::atomic::{AtomicU32, Ordering},
};
use tauri::{AppHandle, Emitter, Manager};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::core::{Interface, PWSTR};

fn name(kind: COREWEBVIEW2_PERMISSION_KIND) -> Option<&'static str> {
    Some(match kind {
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => "microphone",
        COREWEBVIEW2_PERMISSION_KIND_CAMERA => "camera",
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => "geolocation",
        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => "notifications",
        COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS => "sensors",
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => "clipboard-read",
        COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS => "downloads",
        COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE => "files",
        COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS => "local-fonts",
        COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES => "midi",
        COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT => "window-management",
        // (autoplay and the rest: WebView2's own rules)
        _ => return None,
    })
}

/// "https://www.example.com:8443/path" → "https://www.example.com:8443"
pub fn origin(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else { return String::new() };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    format!("{}://{}", scheme.to_lowercase(), host.to_lowercase())
}

struct Pending {
    args: ICoreWebView2PermissionRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
    origin: String,
    kind: &'static str,
    private: bool,
}
thread_local! {
    static PENDING: RefCell<HashMap<u32, Pending>> = RefCell::new(HashMap::new());
}
static NEXT: AtomicU32 = AtomicU32::new(1);

/// Wires one tab's permission requests (wv2::hook).
pub fn hook(app: AppHandle, id: String, private: bool, core: &ICoreWebView2) -> windows::core::Result<()> {
    let mut tok = 0i64;
    unsafe {
        core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let Some(kind) = name(kind) else { return Ok(()) };
                let mut p = PWSTR::null();
                args.Uri(&mut p)?;
                let origin = origin(&s(p));
                // (a frame's request is the page's; the answer is kept by us, not by WebView2)
                if let Ok(a2) = args.cast::<ICoreWebView2PermissionRequestedEventArgs2>() {
                    let _ = a2.SetHandled(true);
                }
                if let Ok(a3) = args.cast::<ICoreWebView2PermissionRequestedEventArgs3>() {
                    let _ = a3.SetSavesInProfile(false);
                }
                let saved = app.state::<App>().store.settings()["sitePermissions"][&origin][kind].as_str().map(String::from);
                match saved.as_deref() {
                    Some("allow") if !private => args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?,
                    Some("deny") if !private => args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?,
                    _ => {
                        let deferral = args.GetDeferral()?;
                        let pid = NEXT.fetch_add(1, Ordering::Relaxed);
                        PENDING.with(|m| m.borrow_mut().insert(pid, Pending { args: args.clone(), deferral, origin: origin.clone(), kind, private }));
                        let _ = app.emit("perm", json!({ "id": pid, "tab": id, "origin": origin, "kind": kind, "private": private }));
                    }
                }
                Ok(())
            })),
            &mut tok,
        )?;
    }
    Ok(())
}

fn save(app: &AppHandle, origin: &str, kind: &str, value: &str) {
    let s = {
        let st = app.state::<App>();
        let mut doc = st.store.settings.lock().unwrap();
        if value.is_empty() {
            if let Some(site) = doc.value["sitePermissions"].get_mut(origin).and_then(|v| v.as_object_mut()) {
                site.remove(kind);
                if site.is_empty() {
                    doc.value["sitePermissions"].as_object_mut().map(|o| o.remove(origin));
                }
            }
        } else {
            deep_merge(&mut doc.value, &json!({ "sitePermissions": { origin: { kind: value } } }));
        }
        doc.touch();
        doc.value.clone()
    };
    let _ = app.emit("settings", s);
}

/// The user's answer to a prompt.
#[tauri::command]
pub fn perm_respond(app: AppHandle, id: u32, allow: bool, remember: bool) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(p) = PENDING.with(|m| m.borrow_mut().remove(&id)) else { return };
        unsafe {
            let _ = p.args.SetState(if allow { COREWEBVIEW2_PERMISSION_STATE_ALLOW } else { COREWEBVIEW2_PERMISSION_STATE_DENY });
            let _ = p.deferral.Complete();
        }
        if remember && !p.private {
            save(&a, &p.origin, p.kind, if allow { "allow" } else { "deny" });
        }
    });
}

/// A site's permission changed in Settings or its info popover ("" forgets it: asked again).
#[tauri::command]
pub fn perm_set(app: AppHandle, origin: String, kind: String, value: String) -> Value {
    let v = match value.as_str() {
        "allow" | "deny" => value.as_str(),
        _ => "",
    };
    save(&app, &origin, &kind, v);
    app.state::<App>().store.settings()["sitePermissions"].clone()
}
