//! Each tab's WebView2, reached through its own COM API (Tauri covers only a part of it): page events
//! for the shell, ad blocking, downloads, find in page, freezing background tabs, captures, the task
//! manager's process list.
//!
//! WebView2 objects belong to the UI thread, so they live in thread-locals there and every function
//! here runs on it (`app.run_on_main_thread`).
use crate::{state::App, store::now_ms, urls};
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    path::{Path, PathBuf},
    rc::Rc,
    sync::atomic::{AtomicU32, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::{Interface, BOOL, HSTRING, PWSTR},
    Win32::{
        System::Com::{IStream, STREAM_SEEK_SET},
        UI::{Input::KeyboardAndMouse::*, Shell::SHCreateMemStream},
    },
};

pub struct TabCom {
    pub controller: ICoreWebView2Controller,
    pub core: ICoreWebView2,
    pub private: bool,
    cur: Rc<RefCell<String>>,      // the page's real URL (internal pages as http://tauri.localhost/...)
    allow_internal: Rc<Cell<bool>>, // the next navigation may go to an internal page (the address bar did it)
    find_hooked: Cell<bool>,
    fp_id: Rc<RefCell<Option<String>>>,   // the fingerprinting protection script
    lets_id: Rc<RefCell<Option<String>>>, // the site's scriptlets
    lets_key: Rc<RefCell<String>>,        // ...for which site (shields::scriptlets_for)
    app_nav: Rc<Cell<bool>>,              // the next navigation is the browser's own (the address bar, a bookmark)
}

// ---------- Shields scripts (shields.rs): in place before a page's own scripts ----------
// A script added while a page is already loading only runs from the next page on, so the site's
// scriptlets are put in before the browser loads a page itself, and a page's own move to another site
// waits for them (it is cancelled, and made again once they are in).
fn add_script(core: &ICoreWebView2, js: String, slot: Rc<RefCell<Option<String>>>, then: impl FnOnce() + 'static) {
    let then = RefCell::new(Some(then));
    let r = unsafe {
        core.AddScriptToExecuteOnDocumentCreated(
            &HSTRING::from(js),
            &AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(move |_, sid| {
                *slot.borrow_mut() = Some(sid);
                if let Some(f) = then.borrow_mut().take() {
                    f();
                }
                Ok(())
            })),
        )
    };
    if r.is_err() {
        // (the page loads anyway)
    }
}

fn remove_script(core: &ICoreWebView2, slot: &Rc<RefCell<Option<String>>>) {
    if let Some(old) = slot.borrow_mut().take() {
        let _ = unsafe { core.RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(old)) };
    }
}

/// Puts the scriptlets for `key` in place of the old ones; `go` (an address) is loaded once they are in.
fn swap_scriptlets(core: &ICoreWebView2, id_slot: &Rc<RefCell<Option<String>>>, key_slot: &Rc<RefCell<String>>, key: String, js: String, go: Option<String>) {
    remove_script(core, id_slot);
    *key_slot.borrow_mut() = key;
    let c = core.clone();
    let nav = move || {
        if let Some(url) = go {
            let _ = unsafe { c.Navigate(&HSTRING::from(url.as_str())) };
        }
    };
    if js.is_empty() {
        nav();
    } else {
        add_script(core, js, id_slot.clone(), nav);
    }
}

/// The tabs' Shields scripts again, after the privacy settings changed (UI thread).
pub fn refresh_shields(app: &AppHandle) {
    let js = crate::shields::fp_script(app);
    TABS.with(|t| {
        for tab in t.borrow().values() {
            remove_script(&tab.core, &tab.fp_id);
            if !js.is_empty() {
                add_script(&tab.core, js.clone(), tab.fp_id.clone(), || {});
            }
            // (the scriptlets are put in again at the next page)
            remove_script(&tab.core, &tab.lets_id);
            *tab.lets_key.borrow_mut() = String::new();
        }
    });
}

thread_local! {
    pub static TABS: RefCell<HashMap<String, TabCom>> = RefCell::new(HashMap::new());
    static ENV: RefCell<Option<ICoreWebView2Environment>> = const { RefCell::new(None) };
    static DOWNLOADS: RefCell<HashMap<u32, ICoreWebView2DownloadOperation>> = RefCell::new(HashMap::new());
}
pub static NEXT_DOWNLOAD: AtomicU32 = AtomicU32::new(1);

pub(crate) fn s(p: PWSTR) -> String {
    take_pwstr(p)
}

pub fn emit_tab(app: &AppHandle, id: &str, mut patch: Value) {
    patch["id"] = json!(id);
    let _ = app.emit("tab", patch);
}

pub fn with_tab<T>(id: &str, f: impl FnOnce(&TabCom) -> windows::core::Result<T>) -> Option<T> {
    TABS.with(|t| t.borrow().get(id).and_then(|tab| f(tab).ok()))
}

pub fn env() -> Option<ICoreWebView2Environment> {
    ENV.with(|e| e.borrow().clone())
}

// ---------- keys the browser keeps for itself while a page has the focus ----------
fn key_name(vk: u32) -> Option<String> {
    let vk16 = vk as u16;
    Some(match VIRTUAL_KEY(vk16) {
        k if (0x41..=0x5A).contains(&k.0) => ((k.0 as u8) as char).to_string(),
        k if (0x30..=0x39).contains(&k.0) => ((k.0 as u8) as char).to_string(),
        k if (VK_F1.0..=VK_F24.0).contains(&k.0) => format!("F{}", k.0 - VK_F1.0 + 1),
        VK_LEFT => "Left".into(),
        VK_RIGHT => "Right".into(),
        VK_UP => "Up".into(),
        VK_DOWN => "Down".into(),
        VK_TAB => "Tab".into(),
        VK_PRIOR => "PageUp".into(),
        VK_NEXT => "PageDown".into(),
        VK_ESCAPE => "Esc".into(),
        VK_HOME => "Home".into(),
        VK_END => "End".into(),
        VK_DELETE => "Delete".into(),
        VK_RETURN => "Enter".into(),
        VK_SPACE => "Space".into(),
        VK_OEM_PLUS => "=".into(),
        VK_OEM_MINUS => "-".into(),
        VK_OEM_COMMA => ",".into(),
        VK_OEM_PERIOD => ".".into(),
        VK_OEM_2 => "/".into(),
        VK_ADD => "Plus".into(),
        VK_SUBTRACT => "NumMinus".into(),
        VK_BROWSER_BACK => "BrowserBack".into(),
        VK_BROWSER_FORWARD => "BrowserForward".into(),
        _ => return None,
    })
}

// Modifiers held while a page has the focus, followed from WebView2's own key events: the page's window
// belongs to WebView2's process, so this thread's key state (GetKeyState / GetAsyncKeyState) misses them.
thread_local! {
    static MODS: Cell<(bool, bool, bool)> = const { Cell::new((false, false, false)) }; // ctrl, shift, alt
}

fn track_modifier(vk: u32, down: bool, alt_now: bool) {
    MODS.with(|m| {
        let (mut c, mut s, _) = m.get();
        match VIRTUAL_KEY(vk as u16) {
            VK_CONTROL | VK_LCONTROL | VK_RCONTROL => c = down,
            VK_SHIFT | VK_LSHIFT | VK_RSHIFT => s = down,
            _ => {}
        }
        m.set((c, s, alt_now));
    });
}

fn combo(vk: u32) -> Option<String> {
    let name = key_name(vk)?;
    let (tc, ts, ta) = MODS.with(|m| m.get());
    let held = |k: VIRTUAL_KEY| unsafe { GetAsyncKeyState(k.0 as i32) } as u16 & 0x8000 != 0;
    let mut out = String::new();
    if tc || held(VK_CONTROL) {
        out.push_str("Ctrl+");
    }
    if ta || held(VK_MENU) {
        out.push_str("Alt+");
    }
    if ts || held(VK_SHIFT) {
        out.push_str("Shift+");
    }
    out.push_str(&name);
    Some(out)
}

fn resource_kind(ctx: COREWEBVIEW2_WEB_RESOURCE_CONTEXT) -> &'static str {
    match ctx {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => "document",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "xhr",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => "ping",
        _ => "other",
    }
}

/// Wires one tab's WebView2 (called once, right after Tauri created it).
pub fn hook(app: AppHandle, id: String, private: bool, controller: ICoreWebView2Controller, env: ICoreWebView2Environment) -> windows::core::Result<()> {
    unsafe {
        let core = controller.CoreWebView2()?;
        ENV.with(|e| {
            if e.borrow().is_none() {
                *e.borrow_mut() = Some(env.clone());
            }
        });
        let settings = core.Settings()?;
        settings.SetIsStatusBarEnabled(false)?; // (the shell shows the link under the pointer itself)
        settings.SetIsZoomControlEnabled(true)?;
        settings.SetAreDevToolsEnabled(true)?;

        let cur = Rc::new(RefCell::new(String::new()));
        let allow_internal = Rc::new(Cell::new(false));
        let blocked = Rc::new(Cell::new(0u32));
        let media_seen: Rc<RefCell<std::collections::HashSet<String>>> = Rc::new(RefCell::new(Default::default()));
        let fp_id: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let lets_id: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let lets_key: Rc<RefCell<String>> = Rc::new(RefCell::new(String::new()));
        let upgraded: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None)); // the http:// address tried over https://
        let was_upgraded = Rc::new(Cell::new(false));
        let cleaned = Rc::new(Cell::new(false)); // the address lost its tracking parameters / a tracker's bounce
        let app_nav = Rc::new(Cell::new(false));
        // navigations we cancelled ourselves (to try https://, to put scriptlets in first): their
        // "completed" (cancelled) is not the page's end
        let cancelled: Rc<RefCell<std::collections::HashSet<u64>>> = Rc::new(RefCell::new(Default::default()));
        let protected = Rc::new(Cell::new(false));
        let mut tok = 0i64;

        // title
        {
            let (app, id, cur) = (app.clone(), id.clone(), cur.clone());
            core.add_DocumentTitleChanged(
                &DocumentTitleChangedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    let mut p = PWSTR::null();
                    wv.DocumentTitle(&mut p)?;
                    let title = s(p);
                    if !private {
                        let url = urls::to_display(&cur.borrow());
                        if url.starts_with("http") {
                            app.state::<App>().store.history.lock().unwrap().set_title(&url, &title);
                        }
                    }
                    emit_tab(&app, &id, json!({ "title": title }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        // address
        {
            let (app, id, cur) = (app.clone(), id.clone(), cur.clone());
            core.add_SourceChanged(
                &SourceChangedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    let mut p = PWSTR::null();
                    wv.Source(&mut p)?;
                    let real = s(p);
                    if real == "about:blank" && cur.borrow().is_empty() {
                        return Ok(()); // (the blank page a tab starts on)
                    }
                    let shown = urls::to_display(&real);
                    *cur.borrow_mut() = real;
                    if let Some(t) = app.state::<App>().tabs.lock().unwrap().get_mut(&id) {
                        t.url = shown.clone();
                    }
                    emit_tab(&app, &id, json!({ "url": shown }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        // a navigation starts: websites may not open the browser's own pages
        {
            let (app, id, cur, allow, blocked, seen) = (app.clone(), id.clone(), cur.clone(), allow_internal.clone(), blocked.clone(), media_seen.clone());
            let (lets_id, lets_key, upgraded, was_upgraded, protected, cancelled, cleaned, app_nav) = (lets_id.clone(), lets_key.clone(), upgraded.clone(), was_upgraded.clone(), protected.clone(), cancelled.clone(), cleaned.clone(), app_nav.clone());
            core.add_NavigationStarting(
                &NavigationStartingEventHandler::create(Box::new(move |wv, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut p = PWSTR::null();
                    args.Uri(&mut p)?;
                    let uri = s(p);
                    if uri == "about:blank" && cur.borrow().is_empty() {
                        return Ok(());
                    }
                    // (the browser's own load: once, for this navigation only)
                    let from_app = app_nav.replace(false);
                    // a new page (not back / forward or a reload, not a form sent)
                    let mut kind = COREWEBVIEW2_NAVIGATION_KIND::default();
                    let fresh = args.cast::<ICoreWebView2NavigationStartingEventArgs3>().map(|a| a.NavigationKind(&mut kind).is_ok() && kind == COREWEBVIEW2_NAVIGATION_KIND_NEW_DOCUMENT).unwrap_or(false);
                    let posted = args.RequestHeaders().and_then(|h| {
                        let mut b = BOOL::default();
                        h.Contains(&HSTRING::from("Content-Type"), &mut b).map(|_| b.as_bool())
                    }).unwrap_or(false);
                    // a tracker's bounce page skipped; tracking parameters taken off a page opened from
                    // elsewhere (Brave's lists: tracking.rs)
                    if fresh && !posted && uri.starts_with("http") && !crate::shields::site_off(&app, &uri) {
                        let st = app.state::<App>();
                        let from = cur.borrow().clone();
                        // (opened by the browser itself, or from another site: a site's own links keep what it put in them)
                        let elsewhere = from_app || !from.starts_with("http") || crate::tracking::site(&from) != crate::tracking::site(&uri);
                        let to = st.flags.debounce().then(|| crate::tracking::debounce(&uri)).flatten().or_else(|| (st.flags.strip_params() && elsewhere).then(|| crate::tracking::strip(&uri)).flatten());
                        if let Some(to) = to.filter(|t| *t != uri) {
                            args.SetCancel(true)?;
                            let mut nid = 0u64;
                            let _ = args.NavigationId(&mut nid);
                            cancelled.borrow_mut().insert(nid);
                            cleaned.set(true);
                            let i = id.clone();
                            let _ = app.run_on_main_thread(move || {
                                with_tab(&i, |t| t.core.Navigate(&HSTRING::from(to.as_str())));
                            });
                            return Ok(());
                        }
                    }
                    // HTTPS by default: an http:// page is tried over https:// first
                    if uri.starts_with("http://") {
                        let mut redirected = BOOL::default();
                        let _ = args.IsRedirected(&mut redirected);
                        let tried = upgraded.borrow().clone();
                        if redirected.as_bool() && tried.is_some() {
                            // (the site sends https:// back to http://: it stays on http://)
                            crate::shields::mark_failed(&uri);
                            *upgraded.borrow_mut() = None;
                        } else if let Some(https) = crate::shields::upgrade(&app, &uri) {
                            args.SetCancel(true)?;
                            let mut nid = 0u64;
                            let _ = args.NavigationId(&mut nid);
                            cancelled.borrow_mut().insert(nid);
                            *upgraded.borrow_mut() = Some(uri.clone());
                            let i = id.clone();
                            let _ = app.run_on_main_thread(move || {
                                with_tab(&i, |t| t.core.Navigate(&HSTRING::from(https.as_str())));
                            });
                            return Ok(());
                        }
                    } else if !uri.starts_with("https://") {
                        *upgraded.borrow_mut() = None;
                    }
                    was_upgraded.set(upgraded.borrow().as_deref().is_some_and(|u| crate::shields::host(u) == crate::shields::host(&uri)));
                    // the site's scriptlets, in place before the page's first script runs
                    protected.set(crate::shields::fp_on(&app, &uri));
                    if let Some(wv) = &wv {
                        let (key, js) = crate::shields::scriptlets_for(&app, &uri);
                        if key != *lets_key.borrow() {
                            // (a new page waits for them)
                            let replay = !js.is_empty() && fresh && !posted;
                            if replay {
                                args.SetCancel(true)?;
                                let mut nid = 0u64;
                                let _ = args.NavigationId(&mut nid);
                                cancelled.borrow_mut().insert(nid);
                            }
                            swap_scriptlets(wv, &lets_id, &lets_key, key, js, replay.then(|| uri.clone()));
                            if replay {
                                return Ok(());
                            }
                        }
                    }
                    if urls::is_internal_real(&uri) {
                        let from = cur.borrow().clone();
                        let ok = allow.get() || from.is_empty() || urls::is_internal_real(&from) || from == "about:blank";
                        allow.set(false);
                        if !ok {
                            args.SetCancel(true)?;
                            return Ok(());
                        }
                    }
                    blocked.set(0);
                    seen.borrow_mut().clear();
                    emit_tab(&app, &id, json!({ "loading": true, "blocked": 0, "crashed": false, "media": [] }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        // finished: history, back / forward
        {
            let (app, id, cur) = (app.clone(), id.clone(), cur.clone());
            let (upgraded, was_upgraded, protected, cancelled, cleaned) = (upgraded.clone(), was_upgraded.clone(), protected.clone(), cancelled.clone(), cleaned.clone());
            core.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |wv, args| {
                    let Some(wv) = wv else { return Ok(()) };
                    if cur.borrow().is_empty() {
                        return Ok(()); // (the blank page a tab starts on)
                    }
                    if let Some(a) = &args {
                        let mut nid = 0u64;
                        let _ = a.NavigationId(&mut nid);
                        if cancelled.borrow_mut().remove(&nid) {
                            return Ok(()); // (cancelled by us: the page it was replaced with is on its way)
                        }
                    }
                    let mut ok = BOOL::default();
                    if let Some(a) = &args {
                        a.IsSuccess(&mut ok)?;
                    }
                    // the https:// try failed (no HTTPS, a bad certificate...): back to the http:// page
                    if !ok.as_bool() {
                        let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                        if let Some(a) = &args {
                            let _ = a.WebErrorStatus(&mut status);
                        }
                        let tried = upgraded.borrow().clone();
                        if let Some(http) = tried.filter(|_| status != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED && status != COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED) {
                            crate::shields::mark_failed(&http);
                            *upgraded.borrow_mut() = None;
                            let i = id.clone();
                            let _ = app.run_on_main_thread(move || {
                                with_tab(&i, |t| t.core.Navigate(&HSTRING::from(http.as_str())));
                            });
                            return Ok(());
                        }
                    }
                    *upgraded.borrow_mut() = None;
                    emit_tab(&app, &id, json!({ "httpsUpgraded": was_upgraded.get() && ok.as_bool(), "fpProtected": protected.get(), "cleaned": cleaned.replace(false) }));
                    let (mut back, mut fwd) = (BOOL::default(), BOOL::default());
                    wv.CanGoBack(&mut back)?;
                    wv.CanGoForward(&mut fwd)?;
                    let url = urls::to_display(&cur.borrow());
                    if ok.as_bool() && !private && url.starts_with("http") {
                        let mut p = PWSTR::null();
                        wv.DocumentTitle(&mut p)?;
                        app.state::<App>().store.history.lock().unwrap().add(&url, &s(p));
                    }
                    emit_tab(&app, &id, json!({ "loading": false, "canBack": back.as_bool(), "canForward": fwd.as_bool() }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        {
            let (app, id) = (app.clone(), id.clone());
            core.add_HistoryChanged(
                &HistoryChangedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    let (mut back, mut fwd) = (BOOL::default(), BOOL::default());
                    wv.CanGoBack(&mut back)?;
                    wv.CanGoForward(&mut fwd)?;
                    emit_tab(&app, &id, json!({ "canBack": back.as_bool(), "canForward": fwd.as_bool() }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        if let Ok(c15) = core.cast::<ICoreWebView2_15>() {
            let (app, id) = (app.clone(), id.clone());
            c15.add_FaviconChanged(
                &FaviconChangedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    let mut p = PWSTR::null();
                    wv.cast::<ICoreWebView2_15>()?.FaviconUri(&mut p)?;
                    emit_tab(&app, &id, json!({ "favicon": s(p) }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        {
            let (app, id) = (app.clone(), id.clone());
            core.add_ContainsFullScreenElementChanged(
                &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    let mut fs = BOOL::default();
                    wv.ContainsFullScreenElement(&mut fs)?;
                    emit_tab(&app, &id, json!({ "fullscreen": fs.as_bool() }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        if let Ok(c12) = core.cast::<ICoreWebView2_12>() {
            let (app, id) = (app.clone(), id.clone());
            c12.add_StatusBarTextChanged(
                &StatusBarTextChangedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    let mut p = PWSTR::null();
                    wv.cast::<ICoreWebView2_12>()?.StatusBarText(&mut p)?;
                    emit_tab(&app, &id, json!({ "status": s(p) }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        if let Ok(c8) = core.cast::<ICoreWebView2_8>() {
            let (app, id) = (app.clone(), id.clone());
            c8.add_IsDocumentPlayingAudioChanged(
                &IsDocumentPlayingAudioChangedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    let mut v = BOOL::default();
                    wv.cast::<ICoreWebView2_8>()?.IsDocumentPlayingAudio(&mut v)?;
                    emit_tab(&app, &id, json!({ "audible": v.as_bool() }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        {
            let (app, id) = (app.clone(), id.clone());
            core.add_WindowCloseRequested(
                &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                    emit_tab(&app, &id, json!({ "closeRequested": true }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        {
            let (app, id) = (app.clone(), id.clone());
            core.add_ProcessFailed(
                &ProcessFailedEventHandler::create(Box::new(move |_, _| {
                    emit_tab(&app, &id, json!({ "crashed": true, "loading": false }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        // shortcuts pressed in the page
        {
            let (app, id) = (app.clone(), id.clone());
            controller.add_AcceleratorKeyPressed(
                &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    args.KeyEventKind(&mut kind)?;
                    let mut vk = 0u32;
                    args.VirtualKey(&mut vk)?;
                    let down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
                    let mut st = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                    let _ = args.PhysicalKeyStatus(&mut st);
                    track_modifier(vk, down, st.IsMenuKeyDown.as_bool());
                    if !down {
                        return Ok(());
                    }
                    if let Some(c) = combo(vk) {
                        if app.state::<App>().keys.read().unwrap().contains(&c) {
                            args.SetHandled(true)?;
                            let _ = app.emit("command", json!({ "tab": id, "combo": c }));
                        }
                    }
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        {
            let (app, id) = (app.clone(), id.clone());
            controller.add_ZoomFactorChanged(
                &ZoomFactorChangedEventHandler::create(Box::new(move |c, _| {
                    let Some(c) = c else { return Ok(()) };
                    let mut z = 1.0f64;
                    c.ZoomFactor(&mut z)?;
                    emit_tab(&app, &id, json!({ "zoom": z }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        {
            let (app, id) = (app.clone(), id.clone());
            controller.add_GotFocus(
                &FocusChangedEventHandler::create(Box::new(move |_, _| {
                    let _ = app.emit("tab-focus", json!({ "id": id }));
                    Ok(())
                })),
                &mut tok,
            )?;
            // keys released elsewhere are not reported here: start clean when the page loses the keyboard
            controller.add_LostFocus(
                &FocusChangedEventHandler::create(Box::new(move |_, _| {
                    MODS.with(|m| m.set((false, false, false)));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        // downloads: the browser's own list instead of WebView2's flyout
        if let Ok(c4) = core.cast::<ICoreWebView2_4>() {
            let app = app.clone();
            c4.add_DownloadStarting(
                &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let _ = download_start(&app, &args, private);
                    }
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        // every request: ad blocking, Do Not Track
        {
            let filter = HSTRING::from("*");
            match core.cast::<ICoreWebView2_22>() {
                Ok(c22) => c22.AddWebResourceRequestedFilterWithRequestSourceKinds(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL)?,
                Err(_) => core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?,
            }
            let (app, id, cur, blocked, env) = (app.clone(), id.clone(), cur.clone(), blocked.clone(), env.clone());
            let last_emit = Cell::new(Instant::now());
            core.add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let req = args.Request()?;
                    let mut p = PWSTR::null();
                    req.Uri(&mut p)?;
                    let uri = s(p);
                    if urls::is_internal_real(&uri) || !uri.starts_with("http") {
                        return Ok(());
                    }
                    let st = app.state::<App>();
                    if st.flags.dnt() {
                        if let Ok(h) = req.Headers() {
                            let _ = h.SetHeader(&HSTRING::from("DNT"), &HSTRING::from("1"));
                            let _ = h.SetHeader(&HSTRING::from("Sec-GPC"), &HSTRING::from("1"));
                        }
                    }
                    let page = cur.borrow().clone();
                    if !st.flags.adblock() || st.flags.adblock_off_for(&urls::host_of(&page)) {
                        return Ok(());
                    }
                    let mut ctx = COREWEBVIEW2_WEB_RESOURCE_CONTEXT::default();
                    args.ResourceContext(&mut ctx)?;
                    let kind = resource_kind(ctx);
                    if kind == "document" {
                        return Ok(());
                    }
                    if st.blocker.should_block(&uri, &page, kind) {
                        let resp = env.CreateWebResourceResponse(None, 403, &HSTRING::from("Blocked"), &HSTRING::from(""))?;
                        args.SetResponse(&resp)?;
                        blocked.set(blocked.get() + 1);
                        if last_emit.get().elapsed().as_millis() > 300 {
                            last_emit.set(Instant::now());
                            emit_tab(&app, &id, json!({ "blocked": blocked.get() }));
                        }
                    }
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        // the lists' rules that hide ad slots on a site
        if let Ok(c2) = core.cast::<ICoreWebView2_2>() {
            let (app, id, cur, blocked) = (app.clone(), id.clone(), cur.clone(), blocked.clone());
            c2.add_DOMContentLoaded(
                &DOMContentLoadedEventHandler::create(Box::new(move |wv, _| {
                    let Some(wv) = wv else { return Ok(()) };
                    emit_tab(&app, &id, json!({ "blocked": blocked.get() }));
                    let page = cur.borrow().clone();
                    let st = app.state::<App>();
                    if !page.starts_with("http") || urls::is_internal_real(&page) || !st.flags.adblock() || st.flags.adblock_off_for(&urls::host_of(&page)) {
                        return Ok(());
                    }
                    if let Some((css, _)) = st.blocker.cosmetic(&page).filter(|(css, _)| !css.is_empty()) {
                        // (its scriptlets already ran, before the page's own scripts: shields.rs)
                        let js = format!(
                            "(()=>{{try{{const s=document.createElement('style');s.textContent={};(document.head||document.documentElement).append(s);}}catch(e){{}}}})()",
                            serde_json::to_string(&css).unwrap_or_default()
                        );
                        wv.ExecuteScript(&HSTRING::from(js), &ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(()))))?;
                    }
                    Ok(())
                })),
                &mut tok,
            )?;
        }

        // videos and sounds the page loads (the media button on the toolbar)
        if let Ok(c2) = core.cast::<ICoreWebView2_2>() {
            let (app, id, cur, seen) = (app.clone(), id.clone(), cur.clone(), media_seen.clone());
            c2.add_WebResourceResponseReceived(
                &WebResourceResponseReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut p = PWSTR::null();
                    args.Request()?.Uri(&mut p)?;
                    let url = s(p);
                    if !url.starts_with("http") {
                        return Ok(());
                    }
                    let resp = args.Response()?;
                    let mut status = 0i32;
                    resp.StatusCode(&mut status)?;
                    if !(200..300).contains(&status) && status != 206 {
                        return Ok(());
                    }
                    let headers = resp.Headers()?;
                    let header = |name: &str| {
                        let mut v = PWSTR::null();
                        if headers.GetHeader(&HSTRING::from(name), &mut v).is_ok() { s(v) } else { String::new() }
                    };
                    let ct = header("Content-Type");
                    let Some(kind) = crate::media::classify(&url, &ct) else { return Ok(()) };
                    let key = url.split('?').next().unwrap_or(&url).to_string();
                    if !seen.borrow_mut().insert(key) {
                        return Ok(());
                    }
                    let size: i64 = header("Content-Range").rsplit('/').next().and_then(|v| v.parse().ok()).or_else(|| header("Content-Length").parse().ok()).unwrap_or(-1);
                    let page = urls::to_display(&cur.borrow());
                    let _ = app.emit("media", json!({ "tab": id, "url": url, "kind": kind, "type": ct, "size": size, "page": page }));
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        let _ = crate::extras::hook_context_menu(app.clone(), id.clone(), &core, &env);
        let _ = crate::perms::hook(app.clone(), id.clone(), private, &core);

        apply_color_scheme_to(&core, &app.state::<App>().store.setting_str(&["appearance", "pageScheme"]), app.state::<App>().store.setting_bool(&["appearance", "dark"]));

        TABS.with(|t| {
            t.borrow_mut().insert(id.clone(), TabCom { controller, core: core.clone(), private, cur, allow_internal, find_hooked: Cell::new(false), fp_id: fp_id.clone(), lets_id, lets_key, app_nav });
        });
        let fp = crate::shields::fp_script(&app);
        if !fp.is_empty() {
            add_script(&core, fp, fp_id, || {});
        }
    }
    Ok(())
}

pub fn forget(id: &str) {
    TABS.with(|t| t.borrow_mut().remove(id));
}

// ---------- page actions ----------
/// A page the browser loads itself (the address bar, a bookmark, a new tab): the site's scriptlets
/// are put in first, so they run before its own scripts.
pub fn navigate_app(app: Option<&AppHandle>, id: &str, url: &str) {
    let real = urls::to_real(url);
    with_tab(id, |t| unsafe {
        if urls::is_internal_real(&real) {
            t.allow_internal.set(true);
        }
        if let Some(app) = app {
            t.app_nav.set(true);
            let target = crate::shields::upgrade(app, &real).unwrap_or_else(|| real.clone());
            let (key, js) = crate::shields::scriptlets_for(app, &target);
            if key != *t.lets_key.borrow() && !js.is_empty() {
                swap_scriptlets(&t.core, &t.lets_id, &t.lets_key, key, js, Some(real.clone()));
                return Ok(());
            }
        }
        t.core.Navigate(&HSTRING::from(real.as_str()))
    });
}

pub fn nav(id: &str, action: &str) {
    with_tab(id, |t| unsafe {
        match action {
            "back" => t.core.GoBack(),
            "forward" => t.core.GoForward(),
            "reload" => t.core.Reload(),
            "stop" => t.core.Stop(),
            "hardReload" => t.core.CallDevToolsProtocolMethod(
                &HSTRING::from("Page.reload"),
                &HSTRING::from("{\"ignoreCache\":true}"),
                &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(()))),
            ),
            "devtools" => t.core.OpenDevToolsWindow(),
            "print" => t.core.cast::<ICoreWebView2_16>()?.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER),
            "saveAs" => t.core.cast::<ICoreWebView2_25>()?.ShowSaveAsUI(&ShowSaveAsUICompletedHandler::create(Box::new(|_, _| Ok(())))),
            "focus" => t.controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC),
            _ => Ok(()),
        }
    });
}

pub fn set_zoom(id: &str, factor: f64) {
    with_tab(id, |t| unsafe { t.controller.SetZoomFactor(factor.clamp(0.25, 5.0)) });
}

pub fn set_muted(id: &str, muted: bool) {
    with_tab(id, |t| unsafe { t.core.cast::<ICoreWebView2_8>()?.SetIsMuted(muted) });
}

/// A tab out of sight for a while: WebView2 drops what it can (caches, the GPU's share) and the page's
/// scripts stop until it is shown again.
pub fn freeze(id: &str) {
    with_tab(id, |t| unsafe {
        if let Ok(c19) = t.core.cast::<ICoreWebView2_19>() {
            c19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW)?;
        }
        t.core.cast::<ICoreWebView2_3>()?.TrySuspend(&TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(()))))
    });
}

pub fn thaw(id: &str) {
    with_tab(id, |t| unsafe {
        if let Ok(c3) = t.core.cast::<ICoreWebView2_3>() {
            let _ = c3.Resume();
        }
        if let Ok(c19) = t.core.cast::<ICoreWebView2_19>() {
            c19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL)?;
        }
        Ok(())
    });
}

pub fn exec(id: &str, js: &str) {
    with_tab(id, |t| unsafe { t.core.ExecuteScript(&HSTRING::from(js), &ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())))) });
}

/// Runs `js` in a tab's page; `done` gets its result as JSON ("null" when it could not run).
pub fn eval(id: &str, js: &str, done: impl FnOnce(String) + 'static) {
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(String)>)));
    let d2 = done.clone();
    let ok = with_tab(id, |t| unsafe {
        t.core.ExecuteScript(
            &HSTRING::from(js),
            &ExecuteScriptCompletedHandler::create(Box::new(move |_, result| {
                if let Some(f) = d2.borrow_mut().take() {
                    f(result);
                }
                Ok(())
            })),
        )
    });
    if ok.is_none() {
        if let Some(f) = done.borrow_mut().take() {
            f("null".into());
        }
    }
}

pub fn print_pdf(id: &str, path: &Path, app: AppHandle) {
    let p = path.to_path_buf();
    with_tab(id, |t| unsafe {
        let p2 = p.clone();
        t.core.cast::<ICoreWebView2_7>()?.PrintToPdf(
            &HSTRING::from(p.as_os_str()),
            None,
            &PrintToPdfCompletedHandler::create(Box::new(move |_, ok| {
                let _ = app.emit("toast", json!({ "kind": "pdf", "ok": ok, "path": p2.to_string_lossy() }));
                Ok(())
            })),
        )
    });
}

/// A picture of what the tab shows (PNG or JPEG bytes) handed to `done` on the UI thread.
pub fn capture(id: &str, jpeg: bool, done: impl FnOnce(Option<Vec<u8>>) + 'static) {
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(Option<Vec<u8>>)>)));
    let d2 = done.clone();
    let started = with_tab(id, move |t| unsafe {
        let stream: IStream = SHCreateMemStream(None).ok_or_else(|| windows::core::Error::from_hresult(windows::core::HRESULT(-1)))?;
        let st2 = stream.clone();
        let fmt = if jpeg { COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG } else { COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG };
        t.core.CapturePreview(
            fmt,
            &stream,
            &CapturePreviewCompletedHandler::create(Box::new(move |hr| {
                let bytes = if hr.is_ok() { read_stream(&st2) } else { None };
                if let Some(f) = d2.borrow_mut().take() {
                    f(bytes);
                }
                Ok(())
            })),
        )
    });
    if started.is_none() {
        if let Some(f) = done.borrow_mut().take() {
            f(None);
        }
    }
}

unsafe fn read_stream(stream: &IStream) -> Option<Vec<u8>> {
    stream.Seek(0, STREAM_SEEK_SET, None).ok()?;
    let mut out = Vec::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let mut read = 0u32;
        let hr = stream.Read(buf.as_mut_ptr() as _, buf.len() as u32, Some(&mut read));
        if hr.is_err() || read == 0 {
            break;
        }
        out.extend_from_slice(&buf[..read as usize]);
    }
    Some(out)
}

// ---------- find in page ----------
pub fn find(app: &AppHandle, id: &str, text: &str, new_search: bool, backwards: bool, case: bool) {
    let app = app.clone();
    let id2 = id.to_string();
    with_tab(id, move |t| unsafe {
        let finder = t.core.cast::<ICoreWebView2_28>()?.Find()?;
        if !t.find_hooked.get() {
            t.find_hooked.set(true);
            let mut tok = 0i64;
            let (a, i) = (app.clone(), id2.clone());
            finder.add_MatchCountChanged(
                &FindMatchCountChangedEventHandler::create(Box::new(move |f, _| {
                    if let Some(f) = f {
                        let (mut n, mut k) = (0i32, 0i32);
                        f.MatchCount(&mut n)?;
                        f.ActiveMatchIndex(&mut k)?;
                        let _ = a.emit("find", json!({ "id": i, "count": n, "active": k }));
                    }
                    Ok(())
                })),
                &mut tok,
            )?;
            let (a, i) = (app.clone(), id2.clone());
            finder.add_ActiveMatchIndexChanged(
                &FindActiveMatchIndexChangedEventHandler::create(Box::new(move |f, _| {
                    if let Some(f) = f {
                        let (mut n, mut k) = (0i32, 0i32);
                        f.MatchCount(&mut n)?;
                        f.ActiveMatchIndex(&mut k)?;
                        let _ = a.emit("find", json!({ "id": i, "count": n, "active": k }));
                    }
                    Ok(())
                })),
                &mut tok,
            )?;
        }
        if text.is_empty() {
            return finder.Stop();
        }
        if new_search {
            let env15 = env().ok_or_else(|| windows::core::Error::from_hresult(windows::core::HRESULT(-1)))?.cast::<ICoreWebView2Environment15>()?;
            let opts = env15.CreateFindOptions()?;
            opts.SetFindTerm(&HSTRING::from(text))?;
            opts.SetIsCaseSensitive(case)?;
            opts.SetShouldHighlightAllMatches(true)?;
            opts.SetSuppressDefaultFindDialog(true)?;
            finder.Start(&opts, &FindStartCompletedHandler::create(Box::new(|_| Ok(()))))
        } else if backwards {
            finder.FindPrevious()
        } else {
            finder.FindNext()
        }
    });
}

pub fn find_stop(id: &str) {
    with_tab(id, |t| unsafe { t.core.cast::<ICoreWebView2_28>()?.Find()?.Stop() });
}

// ---------- the profile ----------
fn apply_color_scheme_to(core: &ICoreWebView2, scheme: &str, dark: bool) {
    let v = match scheme {
        "light" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
        "dark" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
        "system" => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO,
        _ if dark => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
        _ => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
    };
    unsafe {
        if let Ok(p) = core.cast::<ICoreWebView2_13>().and_then(|c| c.Profile()) {
            let _ = p.SetPreferredColorScheme(v);
        }
    }
}

pub fn apply_color_scheme(scheme: &str, dark: bool) {
    TABS.with(|t| {
        for tab in t.borrow().values() {
            apply_color_scheme_to(&tab.core, scheme, dark);
        }
    });
}

/// kinds: "all" | "cache" | "cookies" | "storage"; since: ms (0: everything)
pub fn clear_data(kinds: &str, since: u64, app: AppHandle) {
    let k = match kinds {
        "cache" => COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
        "cookies" => COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES,
        "storage" => COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE,
        _ => COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_PROFILE,
    };
    let core = TABS.with(|t| t.borrow().values().find(|t| !t.private).map(|t| t.core.clone()));
    let Some(core) = core else { return };
    unsafe {
        if let Ok(p) = core.cast::<ICoreWebView2_13>().and_then(|c| c.Profile()).and_then(|p| p.cast::<ICoreWebView2Profile2>()) {
            let done = ClearBrowsingDataCompletedHandler::create(Box::new(move |_| {
                let _ = app.emit("toast", json!({ "kind": "cleared" }));
                Ok(())
            }));
            let _ = if since == 0 {
                p.ClearBrowsingData(k, &done)
            } else {
                p.ClearBrowsingDataInTimeRange(k, since as f64 / 1000.0, now_ms() as f64 / 1000.0, &done)
            };
        }
    }
}

// ---------- downloads ----------
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let path = Path::new(name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "download".into());
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for i in 1..1000 {
        let p = dir.join(format!("{stem} ({i}){ext}"));
        if !p.exists() {
            return p;
        }
    }
    dir.join(name)
}

fn download_state(op: &ICoreWebView2DownloadOperation) -> (String, i64, i64) {
    unsafe {
        let mut st = COREWEBVIEW2_DOWNLOAD_STATE::default();
        let _ = op.State(&mut st);
        let (mut got, mut total) = (0i64, 0i64);
        let _ = op.BytesReceived(&mut got);
        let _ = op.TotalBytesToReceive(&mut total);
        let state = match st {
            COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED => "completed".to_string(),
            COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED => {
                let mut r = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
                let _ = op.InterruptReason(&mut r);
                if r == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED {
                    "paused".into()
                } else if r == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED {
                    "cancelled".into()
                } else {
                    "interrupted".into()
                }
            }
            _ => "progressing".into(),
        };
        (state, got, total)
    }
}

fn download_start(app: &AppHandle, args: &ICoreWebView2DownloadStartingEventArgs, private: bool) -> windows::core::Result<()> {
    unsafe {
        let op = args.DownloadOperation()?;
        args.SetHandled(true)?;
        let mut p = PWSTR::null();
        args.ResultFilePath(&mut p)?;
        let suggested = PathBuf::from(s(p));
        let name = suggested.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "download".into());
        let st = app.state::<App>();
        let dir = st.download_dir();
        let _ = std::fs::create_dir_all(&dir);
        let path = unique_path(&dir, &name);
        args.SetResultFilePath(&HSTRING::from(path.as_os_str()))?;
        let mut p = PWSTR::null();
        op.Uri(&mut p)?;
        let url = s(p);
        let id = NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed);
        let base = json!({
            "id": id, "url": url, "path": path.to_string_lossy(), "file": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            "started": now_ms(), "private": private
        });
        let (state, got, total) = download_state(&op);
        let mut first = base.clone();
        first["state"] = json!(state);
        first["received"] = json!(got);
        first["total"] = json!(total);
        let _ = app.emit("download", first);
        DOWNLOADS.with(|d| d.borrow_mut().insert(id, op.clone()));

        let mut tok = 0i64;
        let (a, b) = (app.clone(), base.clone());
        let last = Cell::new(Instant::now());
        op.add_BytesReceivedChanged(
            &BytesReceivedChangedEventHandler::create(Box::new(move |op, _| {
                let Some(op) = op else { return Ok(()) };
                if last.get().elapsed().as_millis() < 250 {
                    return Ok(());
                }
                last.set(Instant::now());
                let (state, got, total) = download_state(&op);
                let mut v = b.clone();
                v["state"] = json!(state);
                v["received"] = json!(got);
                v["total"] = json!(total);
                let _ = a.emit("download", v);
                Ok(())
            })),
            &mut tok,
        )?;
        let (a, b) = (app.clone(), base);
        op.add_StateChanged(
            &StateChangedEventHandler::create(Box::new(move |op, _| {
                let Some(op) = op else { return Ok(()) };
                let (state, got, total) = download_state(&op);
                let mut v = b.clone();
                v["state"] = json!(state);
                v["received"] = json!(got);
                v["total"] = json!(total);
                if state == "completed" || state == "cancelled" || state == "interrupted" {
                    v["ended"] = json!(now_ms());
                    DOWNLOADS.with(|d| d.borrow_mut().remove(&id));
                    if !private {
                        let st = a.state::<App>();
                        let mut doc = st.store.downloads.lock().unwrap();
                        if let Some(items) = doc.value["items"].as_array_mut() {
                            items.insert(0, v.clone());
                            items.truncate(500);
                        }
                        doc.touch();
                    }
                }
                let _ = a.emit("download", v);
                Ok(())
            })),
            &mut tok,
        )?;
    }
    Ok(())
}

pub fn download_action(id: u32, action: &str) {
    DOWNLOADS.with(|d| {
        if let Some(op) = d.borrow().get(&id) {
            unsafe {
                let _ = match action {
                    "pause" => op.Pause(),
                    "resume" => op.Resume(),
                    "cancel" => op.Cancel(),
                    _ => Ok(()),
                };
            }
        }
    });
}

// ---------- processes, for the task manager ----------
pub struct ProcInfo {
    pub pid: u32,
    pub kind: &'static str,
    pub frames: Vec<String>, // main-frame URLs shown in that process
}

pub fn processes(done: impl FnOnce(Vec<ProcInfo>) + 'static) {
    let Some(env) = env() else { return done(vec![]) };
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(Vec<ProcInfo>)>)));
    let d2 = done.clone();
    let ok = unsafe {
        env.cast::<ICoreWebView2Environment13>().and_then(|e13| {
            e13.GetProcessExtendedInfos(&GetProcessExtendedInfosCompletedHandler::create(Box::new(move |_, list| {
                let mut out = Vec::new();
                if let Some(list) = list {
                    let mut n = 0u32;
                    list.Count(&mut n)?;
                    for i in 0..n {
                        let Ok(info) = list.GetValueAtIndex(i) else { continue };
                        let Ok(pi) = info.ProcessInfo() else { continue };
                        let (mut pid, mut kind) = (0i32, COREWEBVIEW2_PROCESS_KIND::default());
                        pi.ProcessId(&mut pid)?;
                        pi.Kind(&mut kind)?;
                        let mut frames = Vec::new();
                        // (the collection must outlive its iterator: the iterator does not keep it alive)
                        let coll = info.AssociatedFrameInfos().ok();
                        if let Some(fl) = coll.as_ref().and_then(|c| c.GetIterator().ok()) {
                            let mut has = BOOL::default();
                            let _ = fl.HasCurrent(&mut has);
                            while has.as_bool() {
                                if let Ok(f) = fl.GetCurrent() {
                                    let main = f
                                        .cast::<ICoreWebView2FrameInfo2>()
                                        .map(|f2| {
                                            let mut k = COREWEBVIEW2_FRAME_KIND::default();
                                            let _ = f2.FrameKind(&mut k);
                                            k == COREWEBVIEW2_FRAME_KIND_MAIN_FRAME
                                        })
                                        .unwrap_or(true);
                                    if main {
                                        let mut p = PWSTR::null();
                                        if f.Source(&mut p).is_ok() {
                                            frames.push(urls::to_display(&s(p)));
                                        }
                                    }
                                }
                                let _ = fl.MoveNext(&mut has);
                            }
                        }
                        let kind = match kind {
                            COREWEBVIEW2_PROCESS_KIND_BROWSER => "browser",
                            COREWEBVIEW2_PROCESS_KIND_RENDERER => "renderer",
                            COREWEBVIEW2_PROCESS_KIND_GPU => "gpu",
                            COREWEBVIEW2_PROCESS_KIND_UTILITY => "utility",
                            COREWEBVIEW2_PROCESS_KIND_PPAPI_PLUGIN | COREWEBVIEW2_PROCESS_KIND_PPAPI_BROKER => "plugin",
                            _ => "other",
                        };
                        out.push(ProcInfo { pid: pid as u32, kind, frames });
                    }
                }
                if let Some(f) = d2.borrow_mut().take() {
                    f(out);
                }
                Ok(())
            })))
        })
    };
    if ok.is_err() {
        if let Some(f) = done.borrow_mut().take() {
            f(vec![]);
        }
    }
}
