//! Kiểm tra tệp tải về (general.scanDownloads), from TyranWeb: a finished download is scanned when
//! it is a program or a script Windows runs on a double click (.exe, .bat, .msi, .ps1, .lnk…), or an
//! archive (zip, rar, 7z, tar, cab, iso) with one of those (or another archive) inside: its names are
//! read by Windows' own tar (nothing is unpacked; one that cannot be read is scanned too). Other files
//! are left alone. Scanned by Windows Defender (MpCmdRun: a custom scan of that one file, which looks
//! into the archive too), programs first; then VirusTotal's ~70 security vendors, with the user's own
//! API key (kept encrypted with Windows' keys, DPAPI, in vt.key; never in settings.json). A file it
//! has not seen is sent to it as general.vtUpload says ('risky' | 'never' | 'all').
//!
//! The result is the download's `scan`:
//!   { state: queued | scanning | clean | threat | removed | unavailable | error, threat, sha256,
//!     inside, insideCount, unread, vt: { state: queued | looking | uploading | analyzing | done |
//!     unknown | toobig | nokey | badkey | quota | error, stats, date } }
//! kept on its record in the downloads list and in the scan history (scans.json), sent as `download`
//! events, and the result page (unk://scan/?id=…) is asked for (`scan-open`).
//! Every download is also marked as coming from the internet (Zone.Identifier, as Chrome does).
use crate::state::App;
use crate::store::now_ms;
use crate::tauri::{AppHandle, Emitter, Manager};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::{Condvar, Mutex, OnceLock},
    time::{Duration, Instant},
};

const NO_WINDOW: u32 = 0x0800_0000;
const VT_API: &str = "https://www.virustotal.com/api/v3";
const VT_BAD: u64 = 3; // (one or two vendors alone are often wrong)
const UPLOAD_MAX: u64 = 650 * 1024 * 1024;
const DIRECT_MAX: u64 = 32 * 1024 * 1024;
const EICAR: &str = "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

fn risky(name: &str) -> bool {
    let n = name.to_lowercase();
    [".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".msi", ".msix", ".msp", ".appx", ".appxbundle", ".ps1", ".psm1", ".vbs", ".vbe", ".wsf", ".wsh", ".hta", ".lnk", ".jar", ".cpl", ".reg", ".application", ".gadget"].iter().any(|e| n.ends_with(e))
}
fn archive(name: &str) -> bool {
    let n = name.to_lowercase();
    [".zip", ".rar", ".7z", ".tar", ".tgz", ".tar.gz", ".tar.bz2", ".tar.xz", ".cab", ".iso"].iter().any(|e| n.ends_with(e))
}
fn priority(name: &str) -> u8 {
    if risky(name) {
        0
    } else if archive(name) {
        1
    } else {
        2
    }
}

fn run(exe: &Path, args: &[&str], timeout: Duration) -> (i32, String) {
    let child = Command::new(exe).args(args).creation_flags(NO_WINDOW).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn();
    let Ok(mut child) = child else { return (-1, String::new()) };
    let t0 = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if t0.elapsed() > timeout => {
                let _ = child.kill();
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    match child.wait_with_output() {
        Ok(o) => (o.status.code().unwrap_or(-1), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))),
        Err(_) => (-1, String::new()),
    }
}

fn win_dir() -> PathBuf {
    PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
}

/// Is it to be scanned? Some((inside, count, unread)) | None (left alone)
fn worth(file: &Path) -> Option<(Vec<String>, usize, bool)> {
    let name = file.to_string_lossy().to_string();
    if risky(&name) {
        return Some((vec![], 0, false));
    }
    if !archive(&name) {
        return None;
    }
    let tar = win_dir().join("System32").join("tar.exe");
    let (code, out) = if tar.exists() { run(&tar, &["-tf", &name], Duration::from_secs(60)) } else { (-1, String::new()) };
    if code != 0 {
        return Some((vec![], 0, true));
    }
    let inside: Vec<String> = out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty() && (risky(l) || archive(l))).collect();
    if inside.is_empty() {
        None
    } else {
        let n = inside.len();
        Some((inside.into_iter().take(20).collect(), n, false))
    }
}

// ---------- Windows Defender ----------
fn mpcmdrun() -> Option<PathBuf> {
    static S: OnceLock<Option<PathBuf>> = OnceLock::new();
    S.get_or_init(|| {
        let platform = PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into())).join("Microsoft").join("Windows Defender").join("Platform");
        let num = |v: &str| v.split(['.', '-']).map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
        if let Ok(rd) = fs::read_dir(&platform) {
            let mut vers: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
            vers.sort_by(|a, b| num(b).cmp(&num(a)));
            for v in vers {
                let exe = platform.join(&v).join("MpCmdRun.exe");
                if exe.exists() {
                    return Some(exe);
                }
            }
        }
        let old = PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into())).join("Windows Defender").join("MpCmdRun.exe");
        old.exists().then_some(old)
    })
    .clone()
}

fn defender(file: &Path, remediate: bool) -> (String, String) {
    let Some(exe) = mpcmdrun() else { return ("unavailable".into(), String::new()) };
    let f = file.to_string_lossy().to_string();
    let mut args = vec!["-Scan", "-ScanType", "3", "-File", &f];
    if !remediate {
        args.push("-DisableRemediation");
    }
    let (code, out) = run(&exe, &args, Duration::from_secs(20 * 60));
    let threat = out.lines().find_map(|l| l.trim().strip_prefix("Threat").map(|r| r.trim_start_matches([' ', ':']).trim().to_string())).unwrap_or_default();
    if code == 2 || !threat.is_empty() {
        return ("threat".into(), threat);
    }
    if code == 0 && out.to_lowercase().contains("found no threats") {
        return ("clean".into(), String::new());
    }
    let low = out.to_lowercase();
    if ["0x800106ba", "0x80070422", "service", "not running", "disabled"].iter().any(|k| low.contains(k)) {
        return ("unavailable".into(), String::new());
    }
    ("error".into(), String::new())
}

/// What Defender's history says it found in `file` (taken away by its real-time protection).
fn detected_in(file: &Path) -> String {
    let ps = win_dir().join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
    let lit = file.to_string_lossy().replace('\'', "''");
    let script = format!("$f='{lit}'; $d = Get-MpThreatDetection | Where-Object {{ ($_.Resources -join '|').ToLower().Contains($f.ToLower()) }} | Sort-Object InitialDetectionTime -Descending | Select-Object -First 1; if ($d) {{ (Get-MpThreat -ThreatID $d.ThreatID).ThreatName }}");
    let (code, out) = run(&ps, &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script], Duration::from_secs(30));
    if code == 0 {
        out.trim().lines().last().unwrap_or("").to_string()
    } else {
        String::new()
    }
}

fn sha256_of(file: &Path) -> String {
    let Ok(mut f) = fs::File::open(file) else { return String::new() };
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        match f.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => h.update(&buf[..n]),
            Err(_) => return String::new(),
        }
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn mark_of_the_web(file: &Path, url: &str, private: bool) {
    let ads = format!("{}:Zone.Identifier", file.to_string_lossy());
    if Path::new(&ads).exists() {
        return;
    }
    let host = if !private && (url.starts_with("http://") || url.starts_with("https://")) { url } else { "about:internet" };
    let _ = fs::write(&ads, format!("[ZoneTransfer]\r\nZoneId=3\r\nHostUrl={host}\r\n"));
}

// ---------- records ----------
fn kept() -> &'static Mutex<HashMap<String, Value>> {
    static K: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    K.get_or_init(Default::default)
}

fn key_of(id: &Value) -> String {
    match id {
        Value::String(s) => s.clone(),
        v => v.to_string(),
    }
}

fn record(id: &str) -> Option<Value> {
    let st = AppHandle.state::<App>();
    let doc = st.store.downloads.lock().unwrap();
    doc.value["items"].as_array().and_then(|a| a.iter().find(|d| key_of(&d["id"]) == id).cloned()).or_else(|| kept().lock().unwrap().get(id).cloned()).or_else(|| history_of(id))
}

fn set_scan(id: &str, patch: Value) {
    let st = AppHandle.state::<App>();
    let mut rec = None;
    {
        let mut doc = st.store.downloads.lock().unwrap();
        if let Some(d) = doc.value["items"].as_array_mut().and_then(|a| a.iter_mut().find(|d| key_of(&d["id"]) == id)) {
            merge_scan(d, &patch);
            rec = Some(d.clone());
        }
        if rec.is_some() {
            doc.touch();
        }
    }
    if rec.is_none() {
        let mut k = kept().lock().unwrap();
        if let Some(d) = k.get_mut(id) {
            merge_scan(d, &patch);
            rec = Some(d.clone());
        }
    }
    let Some(rec) = rec else { return };
    if rec["private"].as_bool() != Some(true) {
        remember(&rec);
    }
    let _ = AppHandle.emit("download", rec);
}

fn merge_scan(d: &mut Value, patch: &Value) {
    if !d["scan"].is_object() {
        d["scan"] = json!({});
    }
    if let Some(p) = patch.as_object() {
        for (k, v) in p {
            d["scan"][k] = v.clone();
        }
    }
}

// ---------- the scan history (Lịch sử → Đã quét) ----------
// (TyranWeb's scan-history.json: {items: [{id, at, filename, path, url, size, state, scan}]})
fn history_path() -> PathBuf {
    AppHandle.state::<App>().store.data.join("scan-history.json")
}
fn history_lock() -> &'static Mutex<()> {
    static L: Mutex<()> = Mutex::new(());
    &L
}
fn history_read() -> Vec<Value> {
    let v = crate::store::read_json(&history_path()).or_else(|| {
        // (this browser's list from before: data/scans.json)
        let old = AppHandle.state::<App>().profile.join("data").join("scans.json");
        let v = fs::read(&old).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        let _ = fs::rename(&old, old.with_extension("json.old"));
        v.map(|list| json!({ "items": list }))
    });
    let list = match v {
        Some(Value::Object(mut o)) => o.remove("items").unwrap_or(Value::Null),
        Some(v @ Value::Array(_)) => v,
        _ => Value::Null,
    };
    list.as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|mut x| {
            if let Some(f) = x.as_object_mut().and_then(|o| o.remove("filename")) {
                x["file"] = f;
            }
            x
        })
        .collect()
}
fn history_write(items: &[Value]) {
    let items: Vec<Value> = items
        .iter()
        .map(|x| {
            let mut x = x.clone();
            if let Some(f) = x.as_object_mut().and_then(|o| o.remove("file")) {
                x["filename"] = f;
            }
            x
        })
        .collect();
    crate::store::write_json(&history_path(), &json!({ "items": items, "filled": true }));
}
fn history_of(id: &str) -> Option<Value> {
    let _g = history_lock().lock().unwrap();
    history_read().into_iter().find(|x| key_of(&x["id"]) == id)
}
fn remember(rec: &Value) {
    let _g = history_lock().lock().unwrap();
    let mut items = history_read();
    let id = key_of(&rec["id"]);
    let e = json!({ "id": rec["id"], "at": now_ms(), "file": rec["file"], "path": rec["path"], "url": rec["url"], "size": rec["total"].as_i64().filter(|n| *n > 0).or(rec["received"].as_i64()).unwrap_or(0), "state": rec["state"], "scan": rec["scan"] });
    match items.iter_mut().find(|x| key_of(&x["id"]) == id) {
        Some(x) => {
            let at = x["at"].clone();
            *x = e;
            x["at"] = at;
        }
        None => items.insert(0, e),
    }
    items.truncate(500);
    history_write(&items);
    let _ = AppHandle.emit("scanhistory-changed", json!({}));
}

pub fn history_list(text: &str) -> Value {
    let q = text.to_lowercase();
    let _g = history_lock().lock().unwrap();
    json!(history_read().into_iter().filter(|x| q.is_empty() || format!("{} {} {}", x["file"].as_str().unwrap_or(""), x["scan"]["threat"].as_str().unwrap_or(""), x["url"].as_str().unwrap_or("")).to_lowercase().contains(&q)).collect::<Vec<_>>())
}
pub fn history_remove(id: &str) {
    let _g = history_lock().lock().unwrap();
    let items: Vec<Value> = history_read().into_iter().filter(|x| key_of(&x["id"]) != id).collect();
    history_write(&items);
    let _ = AppHandle.emit("scanhistory-changed", json!({}));
}
pub fn history_clear() {
    let _g = history_lock().lock().unwrap();
    history_write(&[]);
    let _ = AppHandle.emit("scanhistory-changed", json!({}));
}

// ---------- the queues ----------
struct Job {
    id: String,
    file: PathBuf,
    priority: u8,
    sha: String,
}
struct Q {
    jobs: Mutex<VecDeque<Job>>,
    ready: Condvar,
}
fn queue(vt: bool) -> &'static Q {
    static A: OnceLock<Q> = OnceLock::new();
    static B: OnceLock<Q> = OnceLock::new();
    let q = if vt { &B } else { &A };
    let mut started = false;
    let q = q.get_or_init(|| {
        started = true;
        Q { jobs: Mutex::new(VecDeque::new()), ready: Condvar::new() }
    });
    if started {
        std::thread::spawn(move || worker(vt));
    }
    q
}
fn push(vt: bool, job: Job) {
    let q = queue(vt);
    let mut j = q.jobs.lock().unwrap();
    j.push_back(job);
    j.make_contiguous().sort_by_key(|x| x.priority);
    q.ready.notify_one();
}
fn worker(vt: bool) {
    let q = queue(vt);
    loop {
        let job = {
            let mut j = q.jobs.lock().unwrap();
            while j.is_empty() {
                j = q.ready.wait(j).unwrap();
            }
            j.pop_front().unwrap()
        };
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| if vt { vt_job(&job) } else { scan_job(&job) }));
        if r.is_err() {
            set_scan(&job.id, if vt { json!({ "vt": { "state": "error" } }) } else { json!({ "state": "error" }) });
        }
    }
}

fn scan_job(job: &Job) {
    set_scan(&job.id, json!({ "state": "scanning" }));
    if !job.file.exists() {
        let threat = detected_in(&job.file);
        set_scan(&job.id, if threat.is_empty() { json!({ "state": "error" }) } else { json!({ "state": "removed", "threat": threat }) });
        return;
    }
    let f2 = job.file.clone();
    let hash = std::thread::spawn(move || sha256_of(&f2));
    let (mut state, mut threat) = defender(&job.file, false);
    let sha = hash.join().unwrap_or_default();
    if state == "clean" && !job.file.exists() {
        let t = detected_in(&job.file);
        if !t.is_empty() {
            state = "removed".into();
            threat = t;
        }
    }
    set_scan(&job.id, json!({ "state": state, "threat": threat, "sha256": sha }));
    if state == "threat" || state == "removed" {
        let _ = AppHandle.emit("download-threat", record(&job.id).unwrap_or(Value::Null));
    }
    if !sha.is_empty() {
        to_vt(&job.id, &job.file, &sha, job.priority);
    }
}

fn to_vt(id: &str, file: &Path, sha: &str, priority: u8) {
    if !has_key() {
        return set_scan(id, json!({ "vt": { "state": "nokey" } }));
    }
    set_scan(id, json!({ "vt": { "state": "queued" } }));
    push(true, Job { id: id.into(), file: file.into(), priority, sha: sha.into() });
}

fn vt_bad(scan: &Value) -> bool {
    scan["vt"]["stats"]["malicious"].as_u64().unwrap_or(0) >= VT_BAD
}

fn vt_job(job: &Job) {
    let was = record(&job.id).map(|r| vt_bad(&r["scan"])).unwrap_or(false);
    let risky_file = priority(&job.file.to_string_lossy()) < 2;
    let id = job.id.clone();
    vt_check(&job.file, &job.sha, risky_file, &|vt| set_scan(&id, json!({ "vt": vt })));
    if let Some(r) = record(&job.id) {
        let s = &r["scan"];
        if !was && vt_bad(s) && s["state"] != "threat" && s["state"] != "removed" {
            let _ = AppHandle.emit("download-threat", r.clone());
        }
    }
}

/// A finished download (its record): marked, and scanned when that is on and it is worth it.
pub fn add(rec: Value) {
    let id = key_of(&rec["id"]);
    let path = PathBuf::from(rec["path"].as_str().unwrap_or(""));
    if id.is_empty() || path.as_os_str().is_empty() {
        return;
    }
    mark_of_the_web(&path, rec["url"].as_str().unwrap_or(""), rec["private"].as_bool().unwrap_or(false));
    let st = AppHandle.state::<App>();
    let s = st.store.settings();
    if s["general"]["scanDownloads"].as_bool() == Some(false) || priority(&path.to_string_lossy()) > 1 {
        return;
    }
    let Some((inside, count, unread)) = worth(&path) else { return };
    let listed = st.store.downloads.lock().unwrap().value["items"].as_array().map(|a| a.iter().any(|d| key_of(&d["id"]) == id)).unwrap_or(false);
    if !listed {
        kept().lock().unwrap().insert(id.clone(), rec.clone());
    }
    set_scan(&id, json!({ "state": "queued", "inside": inside, "insideCount": if count > 0 { count } else { inside.len() }, "unread": unread }));
    if s["general"]["scanTab"].as_str() != Some("off") {
        let _ = AppHandle.emit("scan-open", json!({ "id": rec["id"] }));
    }
    push(false, Job { id, file: path.clone(), priority: priority(&path.to_string_lossy()), sha: String::new() });
}

/// For the result page: the download's record and VirusTotal's report on it.
pub fn details(id: &str) -> Value {
    let Some(rec) = record(id) else { return Value::Null };
    let sha = rec["scan"]["sha256"].as_str().unwrap_or("").to_string();
    let p = rec["path"].as_str().or(rec["file"].as_str()).unwrap_or("").to_string();
    json!({ "rec": rec, "report": report(&sha), "hasKey": has_key(), "risky": priority(&p) < 2 })
}

pub fn recheck(id: &str) -> bool {
    let Some(rec) = record(id) else { return false };
    let sha = rec["scan"]["sha256"].as_str().unwrap_or("").to_string();
    let busy = ["queued", "looking", "uploading", "analyzing"].contains(&rec["scan"]["vt"]["state"].as_str().unwrap_or(""));
    if sha.is_empty() || busy {
        return false;
    }
    let p = PathBuf::from(rec["path"].as_str().unwrap_or(""));
    to_vt(id, &p, &sha, priority(&p.to_string_lossy()));
    true
}

fn is_threat(scan: &Value) -> bool {
    scan["state"] == "threat" || scan["state"] == "removed" || vt_bad(scan)
}

/// May it be opened? A threat never; a program still being scanned once it is found clean.
pub fn may_open(path: &str) -> bool {
    let find = || {
        let st = AppHandle.state::<App>();
        let doc = st.store.downloads.lock().unwrap();
        doc.value["items"].as_array().and_then(|a| a.iter().find(|d| d["path"].as_str() == Some(path)).cloned())
    };
    let t0 = Instant::now();
    loop {
        let Some(rec) = find() else { return true };
        let s = &rec["scan"];
        let pending = ["queued", "scanning"].contains(&s["state"].as_str().unwrap_or(""));
        if !pending || priority(path) >= 2 || t0.elapsed() > Duration::from_secs(20 * 60) {
            return !is_threat(s);
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

/// A threat handed to Defender (quarantined: Windows Security can give it back); one only
/// VirusTotal's vendors flag goes to the Recycle Bin.
pub fn quarantine(id: &str) -> bool {
    let Some(rec) = record(id) else { return false };
    let p = PathBuf::from(rec["path"].as_str().unwrap_or(""));
    if p.as_os_str().is_empty() || !(rec["scan"]["state"] == "threat" || vt_bad(&rec["scan"])) {
        return false;
    }
    if p.exists() {
        defender(&p, true);
    }
    for _ in 0..10 {
        if !p.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    if p.exists() {
        let ps = win_dir().join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
        let lit = p.to_string_lossy().replace('\'', "''");
        let script = format!("Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{lit}','OnlyErrorDialogs','SendToRecycleBin')");
        run(&ps, &["-NoProfile", "-NonInteractive", "-Command", &script], Duration::from_secs(30));
    }
    if p.exists() {
        return false;
    }
    set_scan(id, json!({ "state": "removed" }));
    true
}

// ---------- VirusTotal ----------
fn key_file() -> PathBuf {
    AppHandle.state::<App>().profile.join("vt.key")
}
fn key_cell() -> &'static Mutex<Option<String>> {
    static K: Mutex<Option<String>> = Mutex::new(None);
    &K
}
fn get_key() -> String {
    let mut k = key_cell().lock().unwrap();
    if k.is_none() {
        *k = Some(fs::read(key_file()).ok().and_then(|b| crate::secret::unprotect(&b)).and_then(|b| String::from_utf8(b).ok()).unwrap_or_default());
    }
    k.clone().unwrap_or_default()
}
pub fn has_key() -> bool {
    !get_key().is_empty()
}
/// A key the user gave, tried first: "ok" | "badkey" | "error"
pub fn set_key(value: &str) -> String {
    let v = value.trim().to_string();
    if v.len() != 64 || !v.chars().all(|c| c.is_ascii_hexdigit()) {
        return "badkey".into();
    }
    match ask_with(&v, &format!("/files/{EICAR}"), None) {
        Ok(_) => {}
        Err(e) => return if e == "badkey" { "badkey".into() } else { "error".into() },
    }
    let Some(sealed) = crate::secret::protect(v.as_bytes()) else { return "error".into() };
    if fs::write(key_file(), sealed).is_err() {
        return "error".into();
    }
    *key_cell().lock().unwrap() = Some(v);
    "ok".into()
}
pub fn clear_key() {
    let _ = fs::remove_file(key_file());
    *key_cell().lock().unwrap() = Some(String::new());
}

// 4 asks a minute (a free key)
fn slot() {
    static STAMPS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
    loop {
        let mut s = STAMPS.lock().unwrap();
        while s.front().is_some_and(|t| t.elapsed() > Duration::from_secs(61)) {
            s.pop_front();
        }
        if s.len() < 4 {
            s.push_back(Instant::now());
            return;
        }
        let wait = Duration::from_secs(61).saturating_sub(s.front().unwrap().elapsed()) + Duration::from_millis(50);
        drop(s);
        std::thread::sleep(wait);
    }
}

enum Body<'a> {
    File(&'a Path, String),
}

/// VirusTotal's answer (JSON), None for "not found"; Err("nokey" | "badkey" | "quota" | "error")
fn ask_with(key: &str, where_: &str, body: Option<Body>) -> Result<Option<Value>, String> {
    let url = if where_.starts_with("http") { where_.to_string() } else { format!("{VT_API}{where_}") };
    for tries in 0..4 {
        slot();
        let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(if body.is_some() { 1800 } else { 60 })).build();
        let res = match &body {
            None => agent.get(&url).set("x-apikey", key).set("accept", "application/json").call(),
            Some(Body::File(p, name)) => {
                let boundary = format!("----unk{}", now_ms());
                let head = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: application/octet-stream\r\n\r\n", name.replace('"', "_"));
                let tail = format!("\r\n--{boundary}--\r\n");
                let Ok(f) = fs::File::open(p) else { return Err("error".into()) };
                let len = f.metadata().map(|m| m.len()).unwrap_or(0) + head.len() as u64 + tail.len() as u64;
                let reader = std::io::Cursor::new(head.into_bytes()).chain(f).chain(std::io::Cursor::new(tail.into_bytes()));
                agent.post(&url).set("x-apikey", key).set("accept", "application/json").set("Content-Type", &format!("multipart/form-data; boundary={boundary}")).set("Content-Length", &len.to_string()).send(reader)
            }
        };
        match res {
            Ok(r) => return r.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).map(Some).ok_or_else(|| "error".into()),
            Err(ureq::Error::Status(404, _)) => return Ok(None),
            Err(ureq::Error::Status(401 | 403, _)) => return Err("badkey".into()),
            Err(ureq::Error::Status(429, _)) => {
                if tries < 3 {
                    std::thread::sleep(Duration::from_secs(61));
                    continue;
                }
                return Err("quota".into());
            }
            Err(ureq::Error::Status(code, _)) if code >= 500 && tries < 2 => continue,
            Err(ureq::Error::Transport(_)) if tries < 2 => continue,
            Err(_) => return Err("error".into()),
        }
    }
    Err("error".into())
}

fn ask(where_: &str, body: Option<Body>) -> Result<Option<Value>, String> {
    let k = get_key();
    if k.is_empty() {
        return Err("nokey".into());
    }
    ask_with(&k, where_, body)
}

fn reports_dir() -> PathBuf {
    AppHandle.state::<App>().profile.join("scans")
}
pub fn report(sha: &str) -> Value {
    if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Value::Null;
    }
    fs::read(reports_dir().join(format!("{}.json", sha.to_lowercase()))).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}
fn keep(sha: &str, attrs: &Value) -> Value {
    const FIELDS: &[&str] = &["last_analysis_stats", "last_analysis_results", "last_analysis_date", "type_description", "type_tag", "type_extension", "size", "tags", "meaningful_name", "names", "reputation", "total_votes", "popular_threat_classification", "first_submission_date", "times_submitted"];
    let mut a = serde_json::Map::new();
    for f in FIELDS {
        if !attrs[*f].is_null() {
            a.insert((*f).into(), attrs[*f].clone());
        }
    }
    if let Some(Value::Array(n)) = a.get_mut("names") {
        n.truncate(8);
    }
    let _ = fs::create_dir_all(reports_dir());
    let mut f = fs::File::create(reports_dir().join(format!("{sha}.json"))).ok();
    if let Some(f) = f.as_mut() {
        let _ = f.write_all(json!({ "sha256": sha, "fetchedAt": now_ms(), "attributes": a }).to_string().as_bytes());
    }
    Value::Object(a)
}
fn summary(a: &Value) -> Value {
    json!({ "state": "done", "stats": a["last_analysis_stats"].clone(), "date": a["last_analysis_date"].as_u64().unwrap_or(0) * 1000 })
}

fn vt_check(file: &Path, sha: &str, risky_file: bool, tell: &dyn Fn(Value)) {
    if !has_key() {
        return tell(json!({ "state": "nokey" }));
    }
    let r = (|| -> Result<Value, String> {
        tell(json!({ "state": "looking" }));
        let mut found = ask(&format!("/files/{sha}"), None)?;
        if found.is_none() {
            let mode = AppHandle.state::<App>().store.setting_str(&["general", "vtUpload"]);
            let mode = if mode.is_empty() { "risky".to_string() } else { mode };
            if !(mode == "all" || (mode == "risky" && risky_file)) || !file.exists() {
                return Ok(json!({ "state": "unknown" }));
            }
            let size = fs::metadata(file).map(|m| m.len()).unwrap_or(0);
            if size > UPLOAD_MAX {
                return Ok(json!({ "state": "toobig" }));
            }
            tell(json!({ "state": "uploading" }));
            let to = if size > DIRECT_MAX { ask("/files/upload_url", None)?.and_then(|v| v["data"].as_str().map(|s| s.to_string())).ok_or("error")? } else { format!("{VT_API}/files") };
            let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
            let sent = ask(&to, Some(Body::File(file, name)))?;
            let analysis = sent.as_ref().and_then(|v| v["data"]["id"].as_str().map(|s| s.to_string())).ok_or("error")?;
            tell(json!({ "state": "analyzing" }));
            let mut done = None;
            for _ in 0..40 {
                std::thread::sleep(Duration::from_secs(15));
                let a = ask(&format!("/analyses/{}", analysis), None)?;
                if let Some(a) = a.filter(|a| a["data"]["attributes"]["status"] == "completed") {
                    done = Some(a["data"]["attributes"].clone());
                    break;
                }
            }
            let Some(done) = done else { return Ok(json!({ "state": "error" })) };
            found = ask(&format!("/files/{sha}"), None)?;
            if found.as_ref().map(|f| f["data"]["attributes"]["last_analysis_results"].is_null()).unwrap_or(true) {
                let mut attrs = found.map(|f| f["data"]["attributes"].clone()).unwrap_or(json!({}));
                if !attrs.is_object() {
                    attrs = json!({});
                }
                attrs["last_analysis_stats"] = done["stats"].clone();
                attrs["last_analysis_results"] = done["results"].clone();
                attrs["last_analysis_date"] = json!(done["date"].as_u64().unwrap_or(now_ms() / 1000));
                found = Some(json!({ "data": { "attributes": attrs } }));
            }
        }
        let attrs = found.map(|f| f["data"]["attributes"].clone()).unwrap_or(json!({}));
        Ok(summary(&keep(sha, &attrs)))
    })();
    match r {
        Ok(v) => tell(v),
        Err(e) => tell(json!({ "state": if ["nokey", "badkey", "quota"].contains(&e.as_str()) { e } else { "error".into() } })),
    }
}

/// Scans the app was closed in the middle of: done again once it has settled.
pub fn resume() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(15));
        let items: Vec<Value> = AppHandle.state::<App>().store.downloads.lock().unwrap().value["items"].as_array().cloned().unwrap_or_default();
        for d in items {
            let id = key_of(&d["id"]);
            let p = PathBuf::from(d["path"].as_str().unwrap_or(""));
            let s = &d["scan"];
            if ["queued", "scanning"].contains(&s["state"].as_str().unwrap_or("")) && !p.as_os_str().is_empty() {
                push(false, Job { id, file: p.clone(), priority: priority(&p.to_string_lossy()), sha: String::new() });
            } else if ["queued", "looking", "uploading", "analyzing"].contains(&s["vt"]["state"].as_str().unwrap_or("")) {
                if let Some(sha) = s["sha256"].as_str() {
                    push(true, Job { id, file: p.clone(), priority: priority(&p.to_string_lossy()), sha: sha.into() });
                }
            }
        }
    });
}
