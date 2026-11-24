//! JSON documents kept in the profile (settings, bookmarks, sessions, downloads, notes) and the history.
//! Writes are batched: a change marks the document dirty and a background thread saves it a moment later
//! (and everything is saved on exit), so typing in Settings does not hit the disk on each key.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Objects merge key by key; anything else (arrays included) is replaced.
pub fn deep_merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                match b.get_mut(k) {
                    Some(slot) if slot.is_object() && v.is_object() => deep_merge(slot, v),
                    _ => {
                        b.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (b, p) => *b = p.clone(),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) {
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, bytes).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

pub struct Doc {
    pub value: Value,
    path: PathBuf,
    dirty: bool,
}

impl Doc {
    /// `default`: what a missing file (or missing keys, for objects) falls back to.
    pub fn load(path: PathBuf, default: Value) -> Doc {
        let saved = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let value = match saved {
            Some(saved) if default.is_object() && saved.is_object() => {
                let mut v = default;
                deep_merge(&mut v, &saved);
                v
            }
            Some(saved) => saved,
            None => default,
        };
        Doc { value, path, dirty: false }
    }
    pub fn touch(&mut self) {
        self.dirty = true;
    }
    pub fn save_if_dirty(&mut self) {
        if self.dirty {
            self.dirty = false;
            if let Ok(s) = serde_json::to_vec_pretty(&self.value) {
                write_atomic(&self.path, &s);
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Visit {
    pub url: String,
    pub title: String,
    pub ts: u64,
}

const HISTORY_CAP: usize = 60_000;

pub struct History {
    pub visits: Vec<Visit>, // oldest first
    path: PathBuf,
    dirty: bool,
}

#[derive(Serialize, Clone)]
pub struct Suggestion {
    pub url: String,
    pub title: String,
    pub count: u32,
    pub last: u64,
}

fn fold(s: &str) -> String {
    // lowercase, Vietnamese marks off (so "tieng viet" finds "Tiếng Việt")
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'ả' | 'ã' | 'ạ' | 'ă' | 'ằ' | 'ắ' | 'ẳ' | 'ẵ' | 'ặ' | 'â' | 'ầ' | 'ấ' | 'ẩ' | 'ẫ' | 'ậ' => 'a',
            'è' | 'é' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ế' | 'ể' | 'ễ' | 'ệ' => 'e',
            'ì' | 'í' | 'ỉ' | 'ĩ' | 'ị' => 'i',
            'ò' | 'ó' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ố' | 'ổ' | 'ỗ' | 'ộ' | 'ơ' | 'ờ' | 'ớ' | 'ở' | 'ỡ' | 'ợ' => 'o',
            'ù' | 'ú' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ứ' | 'ử' | 'ữ' | 'ự' => 'u',
            'ỳ' | 'ý' | 'ỷ' | 'ỹ' | 'ỵ' => 'y',
            'đ' => 'd',
            c => c,
        })
        .collect()
}

impl History {
    pub fn load(path: PathBuf) -> History {
        let visits = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        History { visits, path, dirty: false }
    }
    pub fn add(&mut self, url: &str, title: &str) {
        let ts = now_ms();
        // the same page again within half an hour (a reload, a redirect back): one visit
        if let Some(last) = self.visits.iter_mut().rev().take(20).find(|v| v.url == url) {
            if ts - last.ts < 30 * 60 * 1000 {
                last.ts = ts;
                if !title.is_empty() {
                    last.title = title.to_string();
                }
                self.dirty = true;
                return;
            }
        }
        self.visits.push(Visit { url: url.to_string(), title: title.to_string(), ts });
        if self.visits.len() > HISTORY_CAP {
            let extra = self.visits.len() - HISTORY_CAP;
            self.visits.drain(..extra);
        }
        self.dirty = true;
    }
    pub fn set_title(&mut self, url: &str, title: &str) {
        if let Some(v) = self.visits.iter_mut().rev().take(50).find(|v| v.url == url) {
            if v.title != title {
                v.title = title.to_string();
                self.dirty = true;
            }
        }
    }
    pub fn query(&self, text: &str, before: Option<u64>, limit: usize) -> Vec<Visit> {
        let q = fold(text.trim());
        self.visits
            .iter()
            .rev()
            .filter(|v| before.map_or(true, |b| v.ts < b))
            .filter(|v| q.is_empty() || fold(&v.title).contains(&q) || v.url.to_lowercase().contains(&q))
            .take(limit)
            .cloned()
            .collect()
    }
    /// Pages for the address bar: grouped by URL, the most visited / most recent first.
    pub fn suggest(&self, text: &str, limit: usize) -> Vec<Suggestion> {
        let q = fold(text.trim());
        if q.is_empty() {
            return vec![];
        }
        let mut by_url: HashMap<&str, Suggestion> = HashMap::new();
        for v in self.visits.iter().rev().take(20_000) {
            let url_l = v.url.to_lowercase();
            let bare = url_l.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
            if !(bare.starts_with(&q) || url_l.contains(&q) || fold(&v.title).contains(&q)) {
                continue;
            }
            let e = by_url.entry(&v.url).or_insert_with(|| Suggestion { url: v.url.clone(), title: v.title.clone(), count: 0, last: v.ts });
            e.count += 1;
        }
        let mut out: Vec<Suggestion> = by_url.into_values().collect();
        let now = now_ms();
        let score = |s: &Suggestion| {
            let days = (now.saturating_sub(s.last)) as f64 / 86_400_000.0;
            let bare = s.url.to_lowercase();
            let bare = bare.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
            let prefix = if bare.starts_with(&q) { 50.0 } else { 0.0 };
            prefix + (s.count as f64).ln_1p() * 10.0 - days.min(90.0) * 0.3 - bare.len() as f64 * 0.05
        };
        out.sort_by(|a, b| score(b).partial_cmp(&score(a)).unwrap_or(std::cmp::Ordering::Equal));
        out.truncate(limit);
        out
    }
    pub fn touch(&mut self) {
        self.dirty = true;
    }
    pub fn delete_url(&mut self, url: &str) {
        self.visits.retain(|v| v.url != url);
        self.dirty = true;
    }
    pub fn delete_range(&mut self, from: u64, to: u64) {
        self.visits.retain(|v| v.ts < from || v.ts > to);
        self.dirty = true;
    }
    pub fn save_if_dirty(&mut self) {
        if self.dirty {
            self.dirty = false;
            if let Ok(s) = serde_json::to_vec(&self.visits) {
                write_atomic(&self.path, &s);
            }
        }
    }
}

pub struct Store {
    pub dir: PathBuf,
    pub settings: Mutex<Doc>,
    pub bookmarks: Mutex<Doc>,
    pub sessions: Mutex<Doc>,
    pub downloads: Mutex<Doc>,
    pub notes: Mutex<Doc>,
    pub history: Mutex<History>,
    pub engines: Value,
}

impl Store {
    pub fn open(dir: &Path) -> Store {
        let data = dir.join("data");
        let _ = fs::create_dir_all(&data);
        let settings_default: Value = serde_json::from_str(include_str!("../defaults/settings.json")).unwrap();
        let bookmarks_default: Value = serde_json::from_str(include_str!("../defaults/bookmarks.json")).unwrap();
        let mut bookmarks = Doc::load(data.join("bookmarks.json"), Value::Null);
        if bookmarks.value.is_null() {
            bookmarks.value = bookmarks_default;
            bookmarks.touch();
        }
        Store {
            dir: dir.to_path_buf(),
            settings: Mutex::new(Doc::load(data.join("settings.json"), settings_default)),
            bookmarks: Mutex::new(bookmarks),
            sessions: Mutex::new(Doc::load(data.join("sessions.json"), serde_json::json!({ "windows": [], "closed": [] }))),
            downloads: Mutex::new(Doc::load(data.join("downloads.json"), serde_json::json!({ "items": [] }))),
            notes: Mutex::new(Doc::load(data.join("notes.json"), serde_json::json!({ "text": "" }))),
            history: Mutex::new(History::load(data.join("history.json"))),
            engines: serde_json::from_str(include_str!("../defaults/engines.json")).unwrap(),
        }
    }
    pub fn save_all(&self) {
        for d in [&self.settings, &self.bookmarks, &self.sessions, &self.downloads, &self.notes] {
            if let Ok(mut d) = d.lock() {
                d.save_if_dirty();
            }
        }
        if let Ok(mut h) = self.history.lock() {
            h.save_if_dirty();
        }
    }
    pub fn settings(&self) -> Value {
        self.settings.lock().unwrap().value.clone()
    }
    pub fn setting_str(&self, path: &[&str]) -> String {
        let s = self.settings.lock().unwrap();
        let mut v = &s.value;
        for p in path {
            v = &v[*p];
        }
        v.as_str().unwrap_or("").to_string()
    }
    pub fn setting_f64(&self, path: &[&str]) -> f64 {
        let s = self.settings.lock().unwrap();
        let mut v = &s.value;
        for p in path {
            v = &v[*p];
        }
        v.as_f64().unwrap_or(0.0)
    }
    pub fn setting_bool(&self, path: &[&str]) -> bool {
        let s = self.settings.lock().unwrap();
        let mut v = &s.value;
        for p in path {
            v = &v[*p];
        }
        v.as_bool().unwrap_or(false)
    }
}
