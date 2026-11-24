//! More of each tab's WebView2: the browser's own entries in the page's context menu, the DevTools
//! protocol (a tab's back / forward list, picture in picture), cookies, and browser extensions.
//! Like wv2.rs, everything here runs on the UI thread.
use crate::{state::App, wv2::TABS};
use serde_json::{json, Value};
use std::{cell::RefCell, rc::Rc};
use tauri::{AppHandle, Emitter, Manager};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::core::{Interface, BOOL, HSTRING, PWSTR};

fn s(p: PWSTR) -> String {
    take_pwstr(p)
}

/// Text for the browser's own menu entries, in the interface's language (the shell sends them).
fn label(app: &AppHandle, key: &str, fallback: &str) -> String {
    app.state::<App>().labels.read().unwrap().get(key).cloned().unwrap_or_else(|| fallback.to_string())
}

// ---------- context menu ----------
pub fn hook_context_menu(app: AppHandle, id: String, core: &ICoreWebView2, env: &ICoreWebView2Environment) -> windows::core::Result<()> {
    unsafe {
        let c11 = core.cast::<ICoreWebView2_11>()?;
        let env9 = env.cast::<ICoreWebView2Environment9>()?;
        let mut tok = 0i64;
        c11.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let target = args.ContextMenuTarget()?;
                let mut kind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND::default();
                target.Kind(&mut kind)?;
                let get = |has: &dyn Fn(&mut BOOL) -> windows::core::Result<()>, val: &dyn Fn(&mut PWSTR) -> windows::core::Result<()>| -> Option<String> {
                    let mut b = BOOL::default();
                    has(&mut b).ok()?;
                    if !b.as_bool() {
                        return None;
                    }
                    let mut p = PWSTR::null();
                    val(&mut p).ok()?;
                    Some(s(p))
                };
                let src = get(&|b| target.HasSourceUri(b), &|p| target.SourceUri(p));
                let link = get(&|b| target.HasLinkUri(b), &|p| target.LinkUri(p));
                let items = args.MenuItems()?;
                let mut wanted: Vec<(String, &'static str, String)> = vec![];
                if let Some(src) = &src {
                    if kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_IMAGE && src.starts_with("http") {
                        wanted.push((label(&app, "ctx.wallpaper", "Đặt làm hình nền"), "wallpaper", src.clone()));
                        wanted.push((label(&app, "ctx.lens", "Tìm ảnh này với Google Lens"), "lens", src.clone()));
                    }
                    if (kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_VIDEO || kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_AUDIO) && src.starts_with("http") {
                        wanted.push((label(&app, "ctx.media", "Tải xuống bằng trình tải của trình duyệt"), "media", src.clone()));
                    }
                }
                if kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_VIDEO {
                    wanted.push((label(&app, "ctx.pip", "Hình trong hình"), "pip", String::new()));
                }
                if let Some(link) = link.clone().filter(|l| l.starts_with("http")) {
                    wanted.push((label(&app, "ctx.window", "Mở liên kết trong cửa sổ mới"), "window", link.clone()));
                    wanted.push((label(&app, "ctx.private", "Mở liên kết trong cửa sổ InPrivate"), "private", link));
                }
                // the page itself (no link, picture or text under the pointer): a translation of it
                if kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_PAGE && link.is_none() {
                    let mut sel = BOOL::default();
                    let _ = target.HasSelection(&mut sel);
                    let mut page = PWSTR::null();
                    let page = target.PageUri(&mut page).ok().map(|_| s(page)).unwrap_or_default();
                    if !sel.as_bool() && page.starts_with("http") {
                        wanted.push((label(&app, "ctx.translate", "Dịch trang này"), "translate", page));
                    }
                }
                if wanted.is_empty() {
                    return Ok(());
                }
                let mut n = 0u32;
                items.Count(&mut n)?;
                let sep = env9.CreateContextMenuItem(&HSTRING::new(), None, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR)?;
                items.InsertValueAtIndex(n, &sep)?;
                n += 1;
                for (text, action, url) in wanted {
                    let item = env9.CreateContextMenuItem(&HSTRING::from(text), None, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                    let (a, i) = (app.clone(), id.clone());
                    let mut t2 = 0i64;
                    item.add_CustomItemSelected(
                        &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                            let _ = a.emit("ctx", json!({ "tab": i, "action": action, "url": url }));
                            Ok(())
                        })),
                        &mut t2,
                    )?;
                    items.InsertValueAtIndex(n, &item)?;
                    n += 1;
                }
                Ok(())
            })),
            &mut tok,
        )?;
    }
    Ok(())
}

// ---------- DevTools protocol ----------
/// Calls a DevTools protocol method on a tab; `done` gets the JSON result (or None).
pub fn cdp(id: &str, method: &str, params: Value, done: impl FnOnce(Option<Value>) + 'static) {
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(Option<Value>)>)));
    let d2 = done.clone();
    let core = TABS.with(|t| t.borrow().get(id).map(|t| t.core.clone()));
    let started = core.and_then(|core| unsafe {
        core.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(params.to_string()),
            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, json| {
                let v = if hr.is_ok() { serde_json::from_str(&json).ok() } else { None };
                if let Some(f) = d2.borrow_mut().take() {
                    f(v);
                }
                Ok(())
            })),
        )
        .ok()
    });
    if started.is_none() {
        if let Some(f) = done.borrow_mut().take() {
            f(None);
        }
    }
}

/// Picture in picture for the page's biggest playing video (a user gesture, so the page allows it).
pub const PIP_JS: &str = r#"(async () => {
  if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'exit'; }
  const vids = [...document.querySelectorAll('video')].filter(v => v.readyState > 0);
  vids.sort((a, b) => (!b.paused - !a.paused) || (b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight));
  const v = vids[0];
  if (!v) return 'none';
  v.disablePictureInPicture = false;
  await v.requestPictureInPicture();
  return 'ok';
})()"#;

// ---------- cookies (for the browser's own downloader) ----------
pub fn cookies_for(id: &str, url: &str, done: impl FnOnce(String) + 'static) {
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(String)>)));
    let d2 = done.clone();
    let core = TABS.with(|t| t.borrow().get(id).map(|t| t.core.clone()));
    let started = core.and_then(|core| unsafe {
        let cm = core.cast::<ICoreWebView2_2>().ok()?.CookieManager().ok()?;
        cm.GetCookies(
            &HSTRING::from(url),
            &GetCookiesCompletedHandler::create(Box::new(move |_, list| {
                let mut parts = vec![];
                if let Some(list) = list {
                    let mut n = 0u32;
                    list.Count(&mut n)?;
                    for i in 0..n {
                        if let Ok(c) = list.GetValueAtIndex(i) {
                            let (mut a, mut b) = (PWSTR::null(), PWSTR::null());
                            c.Name(&mut a)?;
                            c.Value(&mut b)?;
                            parts.push(format!("{}={}", s(a), s(b)));
                        }
                    }
                }
                if let Some(f) = d2.borrow_mut().take() {
                    f(parts.join("; "));
                }
                Ok(())
            })),
        )
        .ok()
    });
    if started.is_none() {
        if let Some(f) = done.borrow_mut().take() {
            f(String::new());
        }
    }
}

/// The user's cookies for `url` as a Netscape cookie file's text (for yt-dlp: grab.rs); "" without
/// a page open to ask WebView2 through.
pub fn cookies_netscape(url: &str, done: impl FnOnce(String) + 'static) {
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(String)>)));
    let d2 = done.clone();
    let core = TABS.with(|t| t.borrow().values().find(|t| !t.private).map(|t| t.core.clone()));
    let started = core.and_then(|core| unsafe {
        let cm = core.cast::<ICoreWebView2_2>().ok()?.CookieManager().ok()?;
        cm.GetCookies(
            &HSTRING::from(url),
            &GetCookiesCompletedHandler::create(Box::new(move |_, list| {
                let mut out = String::from("# Netscape HTTP Cookie File\n");
                if let Some(list) = list {
                    let mut n = 0u32;
                    list.Count(&mut n)?;
                    for i in 0..n {
                        let Ok(c) = list.GetValueAtIndex(i) else { continue };
                        let (mut name, mut value, mut domain, mut path) = (PWSTR::null(), PWSTR::null(), PWSTR::null(), PWSTR::null());
                        c.Name(&mut name)?;
                        c.Value(&mut value)?;
                        c.Domain(&mut domain)?;
                        c.Path(&mut path)?;
                        let (mut secure, mut session) = (BOOL::default(), BOOL::default());
                        let mut expires = 0f64;
                        let _ = c.IsSecure(&mut secure);
                        let _ = c.IsSession(&mut session);
                        let _ = c.Expires(&mut expires);
                        let domain = s(domain);
                        let exp = if session.as_bool() || expires < 0.0 { 0 } else { expires as i64 };
                        out.push_str(&format!(
                            "{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
                            domain,
                            if domain.starts_with('.') { "TRUE" } else { "FALSE" },
                            s(path),
                            if secure.as_bool() { "TRUE" } else { "FALSE" },
                            exp,
                            s(name),
                            s(value)
                        ));
                    }
                }
                if let Some(f) = d2.borrow_mut().take() {
                    f(out);
                }
                Ok(())
            })),
        )
        .ok()
    });
    if started.is_none() {
        if let Some(f) = done.borrow_mut().take() {
            f(String::new());
        }
    }
}

// ---------- extensions ----------
fn profile7() -> Option<ICoreWebView2Profile7> {
    let core = TABS.with(|t| t.borrow().values().find(|t| !t.private).map(|t| t.core.clone()))?;
    unsafe { core.cast::<ICoreWebView2_13>().ok()?.Profile().ok()?.cast::<ICoreWebView2Profile7>().ok() }
}

pub struct ExtInfo {
    pub id: String,
    pub name: String,
    pub enabled: bool,
}

pub fn ext_list(done: impl FnOnce(Option<Vec<ExtInfo>>) + 'static) {
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(Option<Vec<ExtInfo>>)>)));
    let d2 = done.clone();
    let started = profile7().and_then(|p| unsafe {
        p.GetBrowserExtensions(&ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |_, list| {
            let mut out = vec![];
            if let Some(list) = list {
                let mut n = 0u32;
                list.Count(&mut n)?;
                for i in 0..n {
                    if let Ok(e) = list.GetValueAtIndex(i) {
                        let (mut a, mut b, mut en) = (PWSTR::null(), PWSTR::null(), BOOL::default());
                        e.Id(&mut a)?;
                        e.Name(&mut b)?;
                        e.IsEnabled(&mut en)?;
                        out.push(ExtInfo { id: s(a), name: s(b), enabled: en.as_bool() });
                    }
                }
            }
            if let Some(f) = d2.borrow_mut().take() {
                f(Some(out));
            }
            Ok(())
        })))
        .ok()
    });
    if started.is_none() {
        if let Some(f) = done.borrow_mut().take() {
            f(None);
        }
    }
}

pub fn ext_add(path: &str, done: impl FnOnce(std::result::Result<(String, String), String>) + 'static) {
    let done = Rc::new(RefCell::new(Some(Box::new(done) as Box<dyn FnOnce(std::result::Result<(String, String), String>)>)));
    let d2 = done.clone();
    let started = profile7().and_then(|p| unsafe {
        p.AddBrowserExtension(
            &HSTRING::from(path),
            &ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |hr, ext| {
                let r = match (hr.is_ok(), ext) {
                    (true, Some(e)) => {
                        let (mut a, mut b) = (PWSTR::null(), PWSTR::null());
                        e.Id(&mut a)?;
                        e.Name(&mut b)?;
                        Ok((s(a), s(b)))
                    }
                    _ => Err(format!("WebView2 không nhận tiện ích này ({})", hr.err().map(|e| e.message()).unwrap_or_default())),
                };
                if let Some(f) = d2.borrow_mut().take() {
                    f(r);
                }
                Ok(())
            })),
        )
        .ok()
    });
    if started.is_none() {
        if let Some(f) = done.borrow_mut().take() {
            f(Err("Cần mở ít nhất một tab thường".into()));
        }
    }
}

fn with_ext(id: String, f: impl FnOnce(ICoreWebView2BrowserExtension) + 'static) {
    let f = Rc::new(RefCell::new(Some(Box::new(f) as Box<dyn FnOnce(ICoreWebView2BrowserExtension)>)));
    if let Some(p) = profile7() {
        unsafe {
            let _ = p.GetBrowserExtensions(&ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |_, list| {
                if let Some(list) = list {
                    let mut n = 0u32;
                    list.Count(&mut n)?;
                    for i in 0..n {
                        if let Ok(e) = list.GetValueAtIndex(i) {
                            let mut a = PWSTR::null();
                            e.Id(&mut a)?;
                            if s(a) == id {
                                if let Some(g) = f.borrow_mut().take() {
                                    g(e);
                                }
                                break;
                            }
                        }
                    }
                }
                Ok(())
            })));
        }
    }
}

pub fn ext_enable(id: String, on: bool, app: AppHandle) {
    with_ext(id, move |e| unsafe {
        let _ = e.Enable(on, &BrowserExtensionEnableCompletedHandler::create(Box::new(move |_| {
            let _ = app.emit("extensions", json!({}));
            Ok(())
        })));
    });
}

pub fn ext_remove(id: String, app: AppHandle) {
    with_ext(id, move |e| unsafe {
        let _ = e.Remove(&BrowserExtensionRemoveCompletedHandler::create(Box::new(move |_| {
            let _ = app.emit("extensions", json!({}));
            Ok(())
        })));
    });
}
