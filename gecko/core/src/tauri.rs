//! The few pieces of Tauri's API the shared modules were written against, done here without Tauri:
//! the app's state is one global, and what they "emit" goes to the queue the browser's Gecko side
//! reads (lib.rs `unk_next`), the same events with the same payloads as before.
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Condvar, Mutex, OnceLock},
    time::Duration,
};

#[derive(Clone, Copy, Default)]
pub struct AppHandle;

pub trait Global: 'static {
    fn get() -> &'static Self;
}
impl Global for crate::state::App {
    fn get() -> &'static Self {
        crate::state::app()
    }
}

pub trait Manager {
    fn state<T: Global>(&self) -> &'static T {
        T::get()
    }
}
impl Manager for AppHandle {}

pub trait Emitter {
    fn emit<S: Serialize>(&self, event: &str, payload: S) -> Result<(), ()> {
        push(event, serde_json::to_value(payload).unwrap_or(serde_json::Value::Null));
        Ok(())
    }
}
impl Emitter for AppHandle {}

impl AppHandle {
    pub fn package_info(&self) -> PackageInfo {
        PackageInfo { version: env!("CARGO_PKG_VERSION") }
    }
}
pub struct PackageInfo {
    pub version: &'static str,
}

/// (the commands' "blocking" part: they already run on a thread of their own)
pub async fn spawn_blocking<T>(f: impl FnOnce() -> T) -> Result<T, String> {
    Ok(f())
}

// ---------- the event queue ----------
struct Queue {
    items: Mutex<VecDeque<String>>,
    ready: Condvar,
}
fn queue() -> &'static Queue {
    static Q: OnceLock<Queue> = OnceLock::new();
    Q.get_or_init(|| Queue { items: Mutex::new(VecDeque::new()), ready: Condvar::new() })
}

pub fn push(event: &str, payload: serde_json::Value) {
    let line = serde_json::json!({ "event": event, "payload": payload }).to_string();
    let q = queue();
    q.items.lock().unwrap().push_back(line);
    q.ready.notify_all();
}

/// The next event (JSON), waiting up to `wait` for one.
pub fn next(wait: Duration) -> Option<String> {
    let q = queue();
    let mut items = q.items.lock().unwrap();
    if items.is_empty() {
        items = q.ready.wait_timeout(items, wait).unwrap().0;
    }
    items.pop_front()
}

// ---------- raw-bytes calls (a file from the user's computer) ----------
pub mod ipc {
    use super::HashMap;
    pub enum InvokeBody {
        Raw(Vec<u8>),
        #[allow(dead_code)]
        Json,
    }
    pub struct HeaderValue(String);
    impl HeaderValue {
        pub fn to_str(&self) -> Result<&str, ()> {
            Ok(&self.0)
        }
    }
    pub struct Headers(HashMap<String, HeaderValue>);
    impl Headers {
        pub fn get(&self, name: &str) -> Option<&HeaderValue> {
            self.0.get(&name.to_lowercase())
        }
    }
    pub struct Request<'a> {
        body: InvokeBody,
        headers: Headers,
        _p: std::marker::PhantomData<&'a ()>,
    }
    impl<'a> Request<'a> {
        pub fn new(bytes: Vec<u8>, headers: &serde_json::Value) -> Request<'a> {
            let mut h = HashMap::new();
            if let Some(o) = headers.as_object() {
                for (k, v) in o {
                    h.insert(k.to_lowercase(), HeaderValue(v.as_str().unwrap_or("").to_string()));
                }
            }
            Request { body: InvokeBody::Raw(bytes), headers: Headers(h), _p: std::marker::PhantomData }
        }
        pub fn body(&self) -> &InvokeBody {
            &self.body
        }
        pub fn headers(&self) -> &Headers {
            &self.headers
        }
    }
}
