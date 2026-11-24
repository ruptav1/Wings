use crate::{adblock::Blocker, paths, store::Store};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex, RwLock,
    },
};

/// Settings read on every network request, kept out of the settings document's lock.
#[derive(Default)]
pub struct Flags {
    adblock: AtomicBool,
    dnt: AtomicBool,
    fingerprint: AtomicBool,
    https: AtomicBool,
    block3p: AtomicBool,
    cookie_notices: AtomicBool,
    strip_params: AtomicBool,
    debounce: AtomicBool,
    adblock_off: RwLock<HashSet<String>>,
}

impl Flags {
    pub fn adblock(&self) -> bool {
        self.adblock.load(Ordering::Relaxed)
    }
    pub fn dnt(&self) -> bool {
        self.dnt.load(Ordering::Relaxed)
    }
    pub fn fingerprint(&self) -> bool {
        self.fingerprint.load(Ordering::Relaxed)
    }
    pub fn https(&self) -> bool {
        self.https.load(Ordering::Relaxed)
    }
    pub fn block3p(&self) -> bool {
        self.block3p.load(Ordering::Relaxed)
    }
    pub fn cookie_notices(&self) -> bool {
        self.cookie_notices.load(Ordering::Relaxed)
    }
    pub fn strip_params(&self) -> bool {
        self.strip_params.load(Ordering::Relaxed)
    }
    pub fn debounce(&self) -> bool {
        self.debounce.load(Ordering::Relaxed)
    }
    pub fn adblock_off_for(&self, host: &str) -> bool {
        let off = self.adblock_off.read().unwrap();
        !off.is_empty() && (off.contains(host) || off.iter().any(|d| host.ends_with(&format!(".{d}"))))
    }
    pub fn update(&self, settings: &Value) {
        let p = &settings["privacy"];
        self.adblock.store(p["adblock"].as_bool().unwrap_or(true), Ordering::Relaxed);
        self.dnt.store(p["doNotTrack"].as_bool().unwrap_or(true), Ordering::Relaxed);
        self.fingerprint.store(p["fingerprint"].as_bool().unwrap_or(true), Ordering::Relaxed);
        self.https.store(p["httpsUpgrade"].as_bool().unwrap_or(true), Ordering::Relaxed);
        self.block3p.store(p["blockThirdPartyCookies"].as_bool().unwrap_or(true), Ordering::Relaxed);
        self.cookie_notices.store(p["cookieNotices"].as_bool().unwrap_or(true), Ordering::Relaxed);
        self.strip_params.store(p["stripParams"].as_bool().unwrap_or(true), Ordering::Relaxed);
        self.debounce.store(p["debounce"].as_bool().unwrap_or(true), Ordering::Relaxed);
        let off = p["adblockOff"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_lowercase())).collect()).unwrap_or_default();
        *self.adblock_off.write().unwrap() = off;
    }
}

pub struct TabMeta {
    pub win: String,
    pub url: String,
    pub private: bool,
}

pub struct WinMeta {
    pub private: bool,
    pub restore: Option<Value>, // the saved session it opens with
    pub open_url: Option<String>,
    pub adopt: Option<Value>, // tabs moved in from another window
}

pub struct App {
    pub profile: PathBuf,
    pub store: Store,
    pub blocker: &'static Blocker,
    pub flags: Flags,
    pub keys: RwLock<HashSet<String>>, // shortcuts the browser keeps while a page has the focus
    pub labels: RwLock<HashMap<String, String>>, // the browser's own menu entries, in the interface's language
    pub tabs: Mutex<HashMap<String, TabMeta>>,
    pub windows: Mutex<HashMap<String, WinMeta>>,
    pub next_win: AtomicU32,
    pub quitting: AtomicBool,
}

impl App {
    pub fn new() -> App {
        let profile = paths::profile_dir();
        let store = Store::open(&profile);
        let blocker: &'static Blocker = Box::leak(Box::new(Blocker::new(&profile)));
        let flags = Flags::default();
        flags.update(&store.settings());
        blocker.init_cookie_notices(flags.cookie_notices());
        App {
            profile,
            store,
            blocker,
            flags,
            keys: RwLock::new(HashSet::new()),
            labels: RwLock::new(HashMap::new()),
            tabs: Mutex::new(HashMap::new()),
            windows: Mutex::new(HashMap::new()),
            next_win: AtomicU32::new(1),
            quitting: AtomicBool::new(false),
        }
    }

    pub fn download_dir(&self) -> PathBuf {
        let d = self.store.setting_str(&["general", "downloadDir"]);
        if d.trim().is_empty() {
            paths::downloads_default()
        } else {
            PathBuf::from(d)
        }
    }

    pub fn webview_data_dir(&self) -> PathBuf {
        self.profile.join("webview2")
    }

    /// The same for every webview (WebView2 refuses a second set of options for one data folder).
    /// Fixed at start: a new disk cache size applies at the next start.
    pub fn browser_args(&self) -> String {
        let cache_mb = self.store.setting_f64(&["privacy", "diskCacheMB"]).clamp(50.0, 4096.0) as u64;
        let smooth = self.store.setting_bool(&["general", "smoothScrolling"]);
        let mut a = format!(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,msEdgeTranslate,msShoppingTrigger \
             --disk-cache-size={} --enable-features=OverlayScrollbar",
            cache_mb * 1024 * 1024
        );
        if !smooth {
            a.push_str(" --disable-smooth-scrolling");
        }
        // third-party cookies blocked (Chromium's own mode; a change applies at the next start)
        if self.flags.block3p() {
            a.push_str(" --test-third-party-cookie-phaseout");
        }
        // (for working on the browser: its pages reachable by DevTools from outside, UNK_DEBUG_PORT=9222)
        if let Some(port) = std::env::var("UNK_DEBUG_PORT").ok().and_then(|p| p.parse::<u16>().ok()) {
            a.push_str(&format!(" --remote-debugging-port={port} --remote-allow-origins=http://127.0.0.1:{port}"));
        }
        a
    }
}
