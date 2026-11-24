//! Ứng dụng trên máy (from TyranWeb): the computer's own apps, started from the sidebar (its panel
//! lists them, its rail keeps the pinned ones, settings.pinnedApps). Only signed apps are offered or
//! started: a program from the Start menu whose file carries a valid Authenticode signature, or a
//! Store / MSIX app whose package is signed. They are found the way the Start menu lists them by
//! Windows' own tools (apps.ps1: its shortcuts, Get-StartApps, WinVerifyTrust, Get-AppxPackage);
//! signatures are remembered by file (apps-cache.json) and checked again whenever a file changes.
//! An app is started only from that list (by id), never from a path handed over.
use crate::state::App;
use crate::tauri::{AppHandle, Emitter, Manager};
use base64::Engine as _;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

const SCRIPT: &str = include_str!("apps.ps1");
const NO_WINDOW: u32 = 0x0800_0000;
const SIGNED_PACKAGE: &[&str] = &["Store", "System", "Enterprise", "Developer"];

fn not_app(name: &str) -> bool {
    let n = name.to_lowercase();
    ["uninstall", "gỡ cài đặt", "gỡ bỏ", "readme", "read me", "release notes", "help", "manual", "documentation", "website", "license", "changelog"].iter().any(|k| n.contains(k))
}

fn cache_path() -> PathBuf {
    AppHandle.state::<App>().profile.join("apps-cache.json")
}

/// apps.ps1 in a mode, given stdin: its JSON list back.
fn ps(mode: &str, input: &str) -> Option<Vec<Value>> {
    let script = format!("$mode = '{mode}'\n{SCRIPT}");
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let enc = base64::engine::general_purpose::STANDARD.encode(utf16);
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &enc])
        .creation_flags(NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(input.as_bytes());
    }
    let out = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let v: Value = serde_json::from_str(text.trim().trim_start_matches('\u{feff}')).ok().or_else(|| (text.trim().is_empty()).then(|| json!([])))?;
    Some(match v {
        Value::Array(a) => a,
        Value::Null => vec![],
        o => vec![o],
    })
}

fn stamp(file: &str) -> String {
    fs::metadata(file).map(|m| format!("{}:{}", m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0))).unwrap_or_default()
}

fn id_of(s: &str) -> String {
    Sha256::digest(s.to_lowercase().as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn read_cache() -> Value {
    fs::read(cache_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}))
}

/// Signatures of programs (four PowerShells at once): { exe: { stamp, ok, signer } }
fn verify(files: &[String], sigs: &mut serde_json::Map<String, Value>) {
    let parts: Vec<Vec<String>> = (0..4).map(|i| files.iter().skip(i).step_by(4).cloned().collect()).filter(|p: &Vec<String>| !p.is_empty()).collect();
    let handles: Vec<_> = parts.into_iter().map(|p| std::thread::spawn(move || ps("verify", &serde_json::to_string(&p).unwrap_or_default()).unwrap_or_default())).collect();
    for h in handles {
        for r in h.join().unwrap_or_default() {
            if let Some(p) = r["path"].as_str() {
                sigs.insert(p.to_string(), json!({ "stamp": stamp(p), "ok": r["ok"].as_bool().unwrap_or(false), "signer": r["signer"].as_str().unwrap_or("") }));
            }
        }
    }
}

fn scanning() -> &'static Mutex<()> {
    static S: Mutex<()> = Mutex::new(());
    &S
}

/// The signed apps, looked for again (and remembered with the signatures).
pub fn scan() -> Vec<Value> {
    let _g = scanning().lock().unwrap();
    let cache = read_cache();
    let programs: Vec<Value> = {
        let mut seen = HashSet::new();
        ps("shortcuts", "")
            .unwrap_or_default()
            .into_iter()
            .filter(|s| {
                let (name, exe) = (s["name"].as_str().unwrap_or(""), s["exe"].as_str().unwrap_or(""));
                !name.is_empty() && !not_app(name) && seen.insert(format!("{name}|{exe}").to_lowercase())
            })
            .map(|s| json!({ "id": format!("w{}", id_of(s["lnk"].as_str().unwrap_or(""))), "kind": "program", "name": s["name"], "lnk": s["lnk"], "exe": s["exe"] }))
            .collect()
    };
    let packages = ps("packages", "");
    let mut sigs = cache["sigs"].as_object().cloned().unwrap_or_default();
    let need: Vec<String> = programs.iter().filter_map(|p| p["exe"].as_str()).filter(|exe| sigs.get(*exe).and_then(|s| s["stamp"].as_str()) != Some(stamp(exe).as_str())).map(|s| s.to_string()).collect::<HashSet<_>>().into_iter().collect();
    if !need.is_empty() {
        verify(&need, &mut sigs);
    }
    let pk: Vec<Value> = match packages {
        Some(list) => list
            .into_iter()
            .filter(|p| p["appid"].as_str().is_some() && SIGNED_PACKAGE.contains(&p["kind"].as_str().unwrap_or("")))
            .map(|p| json!({ "id": format!("p{}", id_of(p["appid"].as_str().unwrap_or(""))), "kind": "package", "name": p["name"], "appid": p["appid"], "signer": p["publisher"].as_str().unwrap_or(""), "location": p["location"].as_str().unwrap_or(""), "logo": p["logo"].as_str().unwrap_or("") }))
            .collect(),
        None => cache["list"].as_array().cloned().unwrap_or_default().into_iter().filter(|a| a["kind"] == "package").collect(),
    };
    let mut list: Vec<Value> = programs
        .into_iter()
        .filter_map(|mut p| {
            let s = sigs.get(p["exe"].as_str()?)?;
            if !s["ok"].as_bool().unwrap_or(false) {
                return None;
            }
            p["signer"] = s["signer"].clone();
            Some(p)
        })
        .chain(pk)
        .collect();
    list.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
    let changed = cache["list"] != json!(list);
    let _ = fs::write(cache_path(), json!({ "sigs": sigs, "list": list, "at": crate::store::now_ms() }).to_string());
    if changed {
        let _ = AppHandle.emit("apps-changed", json!({}));
    }
    list
}

fn last() -> &'static Mutex<Option<(Instant, Vec<Value>)>> {
    static L: Mutex<Option<(Instant, Vec<Value>)>> = Mutex::new(None);
    &L
}

fn known(fresh: bool) -> Vec<Value> {
    let cached = {
        let mut l = last().lock().unwrap();
        if l.is_none() {
            if let Some(a) = read_cache()["list"].as_array() {
                *l = Some((Instant::now() - Duration::from_secs(600), a.clone()));
            }
        }
        l.clone()
    };
    match cached {
        None => {
            let list = scan();
            *last().lock().unwrap() = Some((Instant::now(), list.clone()));
            list
        }
        Some((at, list)) => {
            if fresh || at.elapsed() > Duration::from_secs(300) {
                *last().lock().unwrap() = Some((Instant::now(), list.clone()));
                std::thread::spawn(|| {
                    let l = scan();
                    *last().lock().unwrap() = Some((Instant::now(), l));
                });
            }
            list
        }
    }
}

/// What the sidebar shows of them; `icon` is a file the interface can show (a program's own icon
/// comes from its .exe: moz-icon, drawn by the interface).
pub fn list(fresh: bool) -> Value {
    json!(known(fresh)
        .into_iter()
        .map(|a| json!({ "id": a["id"], "name": a["name"], "kind": a["kind"], "signer": a["signer"], "exe": a["exe"], "logo": if a["kind"] == "package" { package_logo(&a) } else { String::new() } }))
        .collect::<Vec<_>>())
}

/// A package's logo, in the size closest to a sidebar icon (the manifest names it without its scale).
fn package_logo(a: &Value) -> String {
    let (loc, logo) = (a["location"].as_str().unwrap_or(""), a["logo"].as_str().unwrap_or(""));
    if loc.is_empty() || logo.is_empty() {
        return String::new();
    }
    let rel = logo.replace('/', "\\");
    let relp = Path::new(&rel);
    let dir = Path::new(loc).join(relp.parent().unwrap_or(Path::new("")));
    let base = relp.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let Ok(rd) = fs::read_dir(&dir) else { return String::new() };
    let rank = |f: &str| -> f64 {
        let low = f.to_lowercase();
        if let Some(i) = low.find("targetsize-") {
            let n: f64 = low[i + 11..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0.0);
            return (n - 48.0).abs() - if low.contains("altform-unplated") { 0.5 } else { 0.0 };
        }
        if let Some(i) = low.find("scale-") {
            let n: f64 = low[i + 6..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0.0);
            return 30.0 + (n - 200.0).abs() / 10.0;
        }
        40.0
    };
    let mut files: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|f| f.to_lowercase().starts_with(&base) && f.to_lowercase().ends_with(".png")).collect();
    files.sort_by(|x, y| rank(x).partial_cmp(&rank(y)).unwrap_or(std::cmp::Ordering::Equal));
    files.first().map(|f| dir.join(f).to_string_lossy().to_string()).unwrap_or_default()
}

/// Starts an app of the list: a program through its own shortcut, once its file still carries its
/// signature; a package through the Start menu's own entry.
pub fn launch(id: &str) -> Result<(), String> {
    let mut a = known(false).into_iter().find(|x| x["id"] == id);
    if a.is_none() {
        a = scan().into_iter().find(|x| x["id"] == id);
    }
    let a = a.ok_or("Không tìm thấy ứng dụng này")?;
    if a["kind"] == "program" {
        let exe = a["exe"].as_str().unwrap_or("").to_string();
        let mut cache = read_cache();
        let mut sigs = cache["sigs"].as_object().cloned().unwrap_or_default();
        if sigs.get(&exe).and_then(|s| s["stamp"].as_str()) != Some(stamp(&exe).as_str()) {
            verify(&[exe.clone()], &mut sigs);
            cache["sigs"] = Value::Object(sigs.clone());
            let _ = fs::write(cache_path(), cache.to_string());
        }
        if !sigs.get(&exe).and_then(|s| s["ok"].as_bool()).unwrap_or(false) {
            return Err("Ứng dụng này không còn chữ ký hợp lệ".into());
        }
        Command::new("explorer.exe").arg(a["lnk"].as_str().unwrap_or("")).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let appid = a["appid"].as_str().unwrap_or("");
    let ok = appid.split_once('!').is_some_and(|(fam, app)| fam.contains('_') && fam.chars().chain(app.chars()).all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)));
    if !ok {
        return Err("Không tìm thấy ứng dụng này".into());
    }
    Command::new("explorer.exe").arg(format!("shell:AppsFolder\\{appid}")).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// (the first time, the apps are looked for a while after the start, so the panel is ready)
pub fn init() {
    if !cache_path().exists() {
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_secs(45));
            let l = scan();
            *last().lock().unwrap() = Some((Instant::now(), l));
        });
    }
}
