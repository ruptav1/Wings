//! Sites' permissions kept in the settings (sitePermissions: { origin: { kind: "allow" | "deny" } });
//! the prompts themselves are the Gecko side's.
use crate::{state::App, store::deep_merge};
use serde_json::{json, Value};
use crate::tauri::{AppHandle, Emitter, Manager};

/// "https://www.example.com:8443/path" → "https://www.example.com:8443"
pub fn origin(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else { return String::new() };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    format!("{}://{}", scheme.to_lowercase(), host.to_lowercase())
}

pub fn save(app: &AppHandle, origin: &str, kind: &str, value: &str) {
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

/// A site's permission changed in Settings or its info popover ("" forgets it: asked again).
pub fn perm_set(app: AppHandle, origin: String, kind: String, value: String) -> Value {
    let v = match value.as_str() {
        "allow" | "deny" => value.as_str(),
        _ => "",
    };
    save(&app, &origin, &kind, v);
    app.state::<App>().store.settings()["sitePermissions"].clone()
}
