use crate::{adblock::Blocker, paths, store::Store};
use serde_json::Value;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock, RwLock,
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

pub struct App {
    pub profile: PathBuf,
    pub store: Store,
    pub blocker: &'static Blocker,
    pub flags: Flags,
}

static APP: OnceLock<App> = OnceLock::new();

/// Opens the profile (once; `dir` is the browser's data folder).
pub fn init(dir: PathBuf) -> &'static App {
    APP.get_or_init(|| {
        let _ = std::fs::create_dir_all(&dir);
        paths::set_profile(dir.clone());
        let store = Store::open(&dir);
        let blocker: &'static Blocker = Box::leak(Box::new(Blocker::new(&dir)));
        let flags = Flags::default();
        flags.update(&store.settings());
        blocker.init_cookie_notices(flags.cookie_notices());
        App { profile: dir, store, blocker, flags }
    })
}

pub fn app() -> &'static App {
    APP.get().expect("unkcore: unk_init first")
}

impl App {
    pub fn download_dir(&self) -> PathBuf {
        let d = self.store.setting_str(&["general", "downloadDir"]);
        if d.trim().is_empty() {
            paths::downloads_default()
        } else {
            PathBuf::from(d)
        }
    }
}
