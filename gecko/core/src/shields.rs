//! Shields, Brave's protections on top of the ad blocker:
//! - the page script, run in every frame before the page's own scripts: fingerprinting protection
//!   (shields-fp.js) and the scriptlets the filter lists call for on that site (YouTube's ads...);
//! - HTTPS by default: an http:// address is tried over https:// first, and kept on http:// for the
//!   rest of the run when the site cannot do it;
//! - third-party cookies blocked (Chromium's own mode, a browser argument: state.rs browser_args).
//!
//! A site with Shields down (the address bar's shield, privacy.adblockOff) gets none of it.
use crate::{state::App, urls};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use crate::tauri::{AppHandle, Emitter, Manager};

fn seed() -> u32 {
    static S: OnceLock<u32> = OnceLock::new();
    *S.get_or_init(|| {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        (t as u32) ^ ((t >> 32) as u32) ^ std::process::id().wrapping_mul(2654435761)
    })
}

/// The host as written (with its www., without port), lowercase.
pub fn host(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or("");
    let h = rest.split(['/', '?', '#']).next().unwrap_or("");
    let h = h.rsplit('@').next().unwrap_or(h);
    h.split(':').next().unwrap_or(h).to_lowercase()
}

/// Shields are down on this site (its shield in the address bar).
pub fn site_off(app: &AppHandle, url: &str) -> bool {
    app.state::<App>().flags.adblock_off_for(&urls::host_of(url))
}

/// Fingerprinting protection, registered once in each tab (empty: turned off). It skips the sites with
/// Shields down itself: the list is written into it, and it is registered again when that changes.
pub fn fp_script(app: &AppHandle) -> String {
    let st = app.state::<App>();
    if !st.flags.fingerprint() {
        return String::new();
    }
    let off = st.store.settings()["privacy"]["adblockOff"].clone();
    let guard = format!(
        "if (/^(http|https):$/.test(location.protocol) && !((h) => {{ const off = {off}; h = h.replace(/^www\\./, ''); return off.some((d) => h === d || h.endsWith('.' + d)); }})((() => {{ try {{ return window.top.location.hostname; }} catch {{ return location.hostname; }} }})()))\n",
        off = serde_json::to_string(&off).unwrap_or_else(|_| "[]".into())
    );
    format!("{guard}{}", include_str!("shields-fp.js").replace("__SEED__", &seed().to_string()))
}

/// Fingerprinting protection on a page (for the Shields panel).
pub fn fp_on(app: &AppHandle, url: &str) -> bool {
    url.starts_with("http") && app.state::<App>().flags.fingerprint() && !site_off(app, url)
}

/// The scriptlets the lists call for on `url`'s site, and a key telling when they change (a page of
/// another site, Shields switched): empty when there are none.
pub fn scriptlets_for(app: &AppHandle, url: &str) -> (String, String) {
    if !url.starts_with("http") || urls::is_internal_real(url) {
        return (String::new(), String::new());
    }
    let st = app.state::<App>();
    if !st.flags.adblock() || site_off(app, url) {
        return (format!("off:{}", host(url)), String::new());
    }
    let lets = st.blocker.scriptlets(url);
    if lets.trim().is_empty() {
        return (format!("none:{}", host(url)), String::new());
    }
    // (frames of other sites keep to their own rules)
    let js = format!("(() => {{ if (location.hostname !== {}) return;\ntry {{\n{lets}\n}} catch (e) {{}}\n}})();", serde_json::to_string(&host(url)).unwrap_or_default());
    (format!("on:{}", host(url)), js)
}

/// Whether the privacy settings changed since the last call (the tabs' Shields scripts follow them).
pub fn privacy_changed(privacy: &serde_json::Value) -> bool {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let now = privacy.to_string();
    let mut last = LAST.lock().unwrap();
    let changed = !last.is_empty() && *last != now;
    *last = now;
    changed
}

// ---------- HTTPS by default ----------
fn https_failed() -> &'static Mutex<HashSet<String>> {
    static F: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    F.get_or_init(Default::default)
}

/// A host worth trying over HTTPS: a public name, not this computer or the local network.
fn upgradable(h: &str) -> bool {
    if h.is_empty() || !h.contains('.') || h.parse::<std::net::IpAddr>().is_ok() || h.starts_with('[') {
        return false;
    }
    let local = [".local", ".lan", ".home", ".internal", ".test", ".localhost", ".home.arpa", ".intranet", ".corp"];
    !(h == "localhost" || local.iter().any(|s| h.ends_with(s)))
}

/// The https:// address to try instead of `url`, when HTTPS by default is on and the site may have it.
pub fn upgrade(app: &AppHandle, url: &str) -> Option<String> {
    let rest = url.strip_prefix("http://")?;
    let h = host(url);
    if !app.state::<App>().flags.https() || !upgradable(&h) || site_off(app, url) || https_failed().lock().unwrap().contains(&h) {
        return None;
    }
    Some(format!("https://{rest}"))
}

/// The site could not be reached over HTTPS: plain HTTP for it until the browser is closed.
pub fn mark_failed(url: &str) {
    https_failed().lock().unwrap().insert(host(url));
}
