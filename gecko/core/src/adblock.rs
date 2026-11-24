//! Ad and tracker blocking with Brave's engine (the `adblock` crate) and the EasyList / EasyPrivacy
//! lists, refreshed once a week. The compiled engine is kept on disk so a start does not parse the lists
//! again (parsing takes ~1s, loading the saved engine a few tens of ms).
//!
//! Brave's resources (the scriptlets uBlock-style rules call for, such as those that take the ads out of
//! YouTube's player data) come with the lists; the page script runs them before the page's own scripts
//! (shields.rs). The cookie-notice list is used only while "Ẩn bảng hỏi cookie" is on.
use adblock::{lists::ParseOptions, request::Request, resources::Resource, Engine, FilterSet};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, RwLock,
    },
    time::{Duration, SystemTime},
};

const LISTS: &[(&str, &str)] = &[
    ("easylist.txt", "https://easylist.to/easylist/easylist.txt"),
    ("easyprivacy.txt", "https://easylist.to/easylist/easyprivacy.txt"),
    ("ublock-filters.txt", "https://ublockorigin.github.io/uAssets/filters/filters.txt"),
    ("abpvn.txt", "https://abpvn.com/android/abpvn.txt"),
    (COOKIE_LIST, "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt"),
    (RESOURCES, "https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json"),
];
const COOKIE_LIST: &str = "cookie-notices.txt";
const RESOURCES: &str = "resources.json";
const WEEK: Duration = Duration::from_secs(7 * 24 * 3600);

pub struct Blocker {
    engine: RwLock<Option<Engine>>,
    dir: PathBuf,
    building: Mutex<bool>,
    cookie_notices: AtomicBool,
}

// The engine is only read after it is built (RwLock); the crate is built without its unsync cache.
unsafe impl Sync for Blocker {}
unsafe impl Send for Blocker {}

impl Blocker {
    pub fn new(profile: &Path) -> Blocker {
        let dir = profile.join("adblock");
        let _ = fs::create_dir_all(&dir);
        Blocker { engine: RwLock::new(None), dir, building: Mutex::new(false), cookie_notices: AtomicBool::new(true) }
    }

    fn engine_file(&self) -> PathBuf {
        self.dir.join("engine.dat")
    }

    /// What the saved engine was built with (a change of the cookie-notice setting builds it again).
    fn config(&self) -> String {
        format!("cookies={}", self.cookie_notices.load(Ordering::Relaxed))
    }

    fn resources(&self) -> Vec<Resource> {
        fs::read_to_string(self.dir.join(RESOURCES)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// "Ẩn bảng hỏi cookie" turned on or off: the engine is built again with or without that list.
    pub fn set_cookie_notices(&'static self, on: bool) {
        if self.cookie_notices.swap(on, Ordering::Relaxed) != on {
            std::thread::spawn(move || self.rebuild(false));
        }
    }

    pub fn init_cookie_notices(&self, on: bool) {
        self.cookie_notices.store(on, Ordering::Relaxed);
    }

    /// Loads the saved engine, then (in the background) downloads the lists when they are missing or
    /// a week old and builds a new one.
    pub fn start(&'static self) {
        std::thread::spawn(move || {
            let same = fs::read_to_string(self.dir.join("engine.cfg")).map(|c| c == self.config()).unwrap_or(false);
            if let (true, Ok(bytes)) = (same, fs::read(self.engine_file())) {
                let mut e = Engine::new(true);
                if e.deserialize(&bytes).is_ok() {
                    e.use_resources(self.resources());
                    *self.engine.write().unwrap() = Some(e);
                }
            }
            let stale = LISTS.iter().any(|(f, _)| {
                fs::metadata(self.dir.join(f))
                    .and_then(|m| m.modified())
                    .map(|t| SystemTime::now().duration_since(t).unwrap_or_default() > WEEK)
                    .unwrap_or(true)
            });
            if stale || self.engine.read().unwrap().is_none() {
                self.rebuild(stale);
            }
        });
    }

    pub fn rebuild(&self, download: bool) {
        {
            let mut b = self.building.lock().unwrap();
            if *b {
                return;
            }
            *b = true;
        }
        if download {
            for (file, url) in LISTS {
                if let Ok(resp) = ureq::get(url).timeout(Duration::from_secs(60)).call() {
                    if let Ok(text) = resp.into_string() {
                        if text.len() > 1000 {
                            let _ = fs::write(self.dir.join(file), text);
                        }
                    }
                }
            }
        }
        let mut set = FilterSet::new(false);
        let mut any = false;
        let cookies = self.cookie_notices.load(Ordering::Relaxed);
        for (file, _) in LISTS {
            if *file == RESOURCES || (*file == COOKIE_LIST && !cookies) {
                continue;
            }
            if let Ok(text) = fs::read_to_string(self.dir.join(file)) {
                set.add_filter_list(&text, ParseOptions::default());
                any = true;
            }
        }
        if any {
            let mut engine = Engine::from_filter_set(set, true);
            if let Ok(bytes) = engine.serialize() {
                let _ = fs::write(self.engine_file(), bytes);
                let _ = fs::write(self.dir.join("engine.cfg"), format!("cookies={cookies}"));
            }
            engine.use_resources(self.resources());
            *self.engine.write().unwrap() = Some(engine);
        }
        *self.building.lock().unwrap() = false;
    }

    pub fn ready(&self) -> bool {
        self.engine.read().map(|e| e.is_some()).unwrap_or(false)
    }

    /// `kind`: script | image | stylesheet | xhr | media | font | websocket | ping | sub_frame | other
    pub fn should_block(&self, url: &str, source: &str, kind: &str) -> bool {
        let Ok(guard) = self.engine.read() else { return false };
        let Some(engine) = guard.as_ref() else { return false };
        let Ok(req) = Request::new(url, if source.is_empty() { url } else { source }, kind) else { return false };
        let r = engine.check_network_request(&req);
        r.matched && r.exception.is_none() || r.important
    }

    /// The scriptlets the lists ask for on a page (run before the page's own scripts: shields.rs).
    pub fn scriptlets(&self, url: &str) -> String {
        let Ok(guard) = self.engine.read() else { return String::new() };
        guard.as_ref().map(|e| e.url_cosmetic_resources(url).injected_script).unwrap_or_default()
    }

    /// CSS hiding the page's ad slots (site-specific rules) and the scriptlets the lists ask for.
    pub fn cosmetic(&self, url: &str) -> Option<(String, String)> {
        let guard = self.engine.read().ok()?;
        let engine = guard.as_ref()?;
        let res = engine.url_cosmetic_resources(url);
        if res.generichide && res.hide_selectors.is_empty() && res.injected_script.is_empty() {
            return None;
        }
        let css = if res.hide_selectors.is_empty() {
            String::new()
        } else {
            let sel: Vec<&str> = res.hide_selectors.iter().map(|s| s.as_str()).collect();
            // in chunks: one invalid selector would void a whole rule
            sel.chunks(200).map(|c| format!("{}{{display:none!important}}", c.join(","))).collect::<Vec<_>>().join("\n")
        };
        Some((css, res.injected_script))
    }
}
